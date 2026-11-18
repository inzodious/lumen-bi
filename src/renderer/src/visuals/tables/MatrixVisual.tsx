/**
 * Matrix visual (pivotTable) renderer: frozen (sticky) row headers + column headers, virtualized
 * rows, +/- expand/collapse on row and column headers (PBIR expansionStates), drill, sorting,
 * subtotal / grand-total styling, blank rows, sparklines and Ctrl+C copy.
 *
 * Layout notes (matched against Microsoft Learn's matrix screenshots):
 *  - the corner shows the column field names on the upper header rows and the row field name(s)
 *    on the last header row;
 *  - group headers / rows above the lowest visible level are bold (they're in-line with
 *    subtotals); collapsed groups show their subtotal;
 *  - a grid-outline line runs under the column headers and right of the row headers; the grand
 *    total row has no top border.
 */
import { useCallback, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { identityKey } from '@core/report/sq'
import type { Scalar } from '@core/model/data'
import type { ContextMenuEntry, VisualProps } from '../contract'
import { fontStyle, measureText, ptToPx, type FontSpec } from '../common/textStyle'
import { applyExpansion, isExpanded, setAllExpanded, setLevelExpanded, setNodeExpanded, type ExpansionEdit, type ExpansionLevel, type ExpansionState } from '../common/expansion'
import { promptDialog } from '../../app/ui'
import { CellContent, Grid, HeaderLabel, headerSeparator, LinkIcon, ResizeHandle, SORT_CARET_H } from './Grid'
import { buildMatrixView, formatLabel, matrixIdentity } from './matrixView'
import { applySort } from './tableModel'
import { headerAlignment, outlineBorders, scopedWidth, type TotalStyle } from './tableFormat'
import { cellPadX, computeWidths, contentWidth, CELL_PAD_X, maxTextWidth, type WidthInput } from './widths'
import { clearScopedWidths, resetColumnWidth, scopeSelector, setColumnWidth, totalSelector, visualObjects, type WidthTarget } from './columnWidths'
import { Message, AUTOSIZE_SAMPLE_ROWS, validWidth } from './TableVisual'
import { pinnedGrandTotalStart, type ColHeaderCell, type RowItem } from './matrixModel'
import { copyToClipboard, copyValueText, isCopyKey, toTsv } from './copy'
import { SPARKLINE_DEFAULT_WIDTH } from './sparklineModel'
import { isUrl } from './cellModel'
import { COLUMN_GROUP_LIMIT, LOAD_MORE_COLUMNS_PX, LOAD_MORE_THRESHOLD, ROW_WINDOW } from './windowQuery'

export function MatrixVisual({ visual, width, height, ctx }: VisualProps) {
  const json = visual.json
  // data windowing (PBI: rows 500 at a time, next window fetched when scrolling near the end);
  // a new query shape (fields, sort, expansion, drill, filters) starts again from the first window
  const shapeKey = JSON.stringify([json?.visual?.query, json?.visual?.expansionStates, ctx.filters, ctx.drill])
  // columns are windowed the same way: 100 column groups at a time, the next window fetched when
  // scrolling near the right edge (PBI's "Top 100 grouping columns" per window)
  const [winState, setWinState] = useState({ key: shapeKey, engine: ctx.engine, win: ROW_WINDOW, colWin: COLUMN_GROUP_LIMIT })
  const current = winState.key === shapeKey && winState.engine === ctx.engine
  const win = current ? winState.win : ROW_WINDOW
  const colWin = current ? winState.colWin : COLUMN_GROUP_LIMIT
  const view = useMemo(() => buildMatrixView(json, ctx, win, colWin), [json, ctx.engine, ctx.filters, ctx.theme, ctx.drill, win, colWin])
  const loadMore = useCallback(() => {
    if (view.data?.hasMore) setWinState({ key: shapeKey, engine: ctx.engine, win: (view.data.window ?? win) + ROW_WINDOW, colWin })
  }, [view, shapeKey, ctx.engine, win, colWin])
  const loadMoreColumns = useCallback(() => {
    if (view.data?.columnsCapped) setWinState({ key: shapeKey, engine: ctx.engine, win, colWin: (view.data.columnWindow ?? colWin) + COLUMN_GROUP_LIMIT })
  }, [view, shapeKey, ctx.engine, win, colWin])
  const [preview, setPreview] = useState<{ col: number; width: number } | undefined>()
  const lastCell = useRef<{ row: number; col: number } | null>(null)
  const f = view.format
  const data = view.data
  const { layout, cells } = view

  const stepped = f.rowHeaders.stepped
  const rowLevels = data?.rowFields.length ?? 0
  const rowHeaderCols = rowLevels === 0 ? (data?.spec.valuesOnRow ? 1 : 0) : stepped ? 1 : rowLevels + (data?.spec.valuesOnRow ? 1 : 0)
  const valuePx = ptToPx(f.values.font.size)
  const rowHeaderPx = ptToPx(f.rowHeaders.font.size)
  const buttonPx = Math.max(8, Math.round(f.rowHeaders.buttonSize))
  const colButtonPx = Math.max(8, Math.round(f.header.buttons.size))
  const showButtons = f.rowHeaders.showButtons && rowLevels > 1
  const showColButtons = f.header.buttons.show && (data?.colFields.length ?? 0) > 1
  // Layout ▸ Freeze ▸ Row headers; the context menu's Freeze / Unfreeze row headers changes it for this session only (PBI)
  const [frozenView, setFrozenView] = useState<{ saved: boolean; frozen: boolean } | undefined>()
  const savedFrozen = !f.rowHeaders.unfrozen
  const frozen = frozenView && frozenView.saved === savedFrozen ? frozenView.frozen : savedFrozen

  // Layout ▸ Column width: `available` is the viewport without the vertical scrollbar (reported by the grid)
  const [viewport, setViewport] = useState<number | undefined>()
  const available = viewport !== undefined ? Math.min(width, viewport) : width
  const widthInputs = useMemo((): WidthInput[] => {
    if (!data) return []
    const maxLevel = Math.max(0, ...layout.items.map((i) => i.level))
    const sample = layout.items.slice(0, AUTOSIZE_SAMPLE_ROWS)
    const totalFont = (it: RowItem) => (it.totalKind === 'grand' ? f.rowTotal.font : f.subTotals.style.font)
    const headerInputs = Array.from({ length: rowHeaderCols }, (_, ci) => {
      const texts = sample.flatMap((it, i) => (stepped || itemColumn(it, rowLevels) === ci ? [view.rowLabels[i]] : []))
      const name = stepped ? data.rowFields.map((r) => r.label)[0] ?? '' : data.rowFields[ci]?.label ?? ''
      return {
        header: name,
        headerFont: f.header.font,
        texts,
        valueFont: { ...f.rowHeaders.font, bold: true },
        explicit: rowHeaderWidth(ci),
        extra: (stepped ? maxLevel * f.rowHeaders.indentation : 0) + (showButtons ? buttonPx + 6 : 0)
      }
    })
    const leafInputs = layout.leaves.map((leaf, li) => {
      const v = data.values[leaf.valueIndex] ?? data.values[0]
      const spark = data.spec.valuesOnRow ? data.values.some((x) => x.sparkline) : !!v?.sparkline
      const rows = spark && !data.spec.valuesOnRow ? [] : cells.slice(0, AUTOSIZE_SAMPLE_ROWS)
      return {
        header: leafHeaderText(li),
        headerFont: { ...f.header.font, bold: f.header.font.bold || leaf.isTotal },
        texts: rows.filter((_, r) => !layout.items[r].isTotal).map((r) => r[li].text),
        valueFont: { ...f.values.font, bold: f.values.font.bold || leaf.isTotal },
        // subtotal / grand-total rows are drawn with their own (bold) font
        extraTexts: rows.flatMap((r, ri) => (layout.items[ri].isTotal && r[li].text ? [{ text: r[li].text, font: totalFont(layout.items[ri]) }] : [])),
        explicit: leafWidth(li),
        extra: (v?.cf?.icon ? valuePx + 4 : 0) + (showColButtons && leaf.collapsed ? colButtonPx + 6 : 0),
        minWidth: spark ? SPARKLINE_DEFAULT_WIDTH : undefined
      }
    })
    return [...headerInputs, ...leafInputs]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])
  const widthOptions = { behavior: f.sizing.behavior, legacyManual: f.sizing.legacyManual, defaultWidth: f.sizing.defaultWidth, wrapHeader: f.header.wordWrap, available }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const widths = useMemo(() => computeWidths(widthInputs, widthOptions), [widthInputs, available])

  /** selector a row-header column's custom width is stored under: its row field (stepped layout: the outermost visible one) */
  function rowHeaderTarget(ci: number): WidthTarget {
    const ref = (stepped ? data?.rowFields[0] : data?.rowFields[ci])?.proj.queryRef
    // no row field (values on rows): Power BI's corner column
    return ref ? { metadata: ref } : { id: 'cornerColumn' }
  }
  function rowHeaderWidth(ci: number): number | undefined {
    if (!data) return undefined
    const ref = (stepped ? data.rowFields[0] : data.rowFields[ci])?.proj.queryRef
    if (!ref) return f.cornerWidth
    if (!stepped) return f.widthByRef.get(ref)
    return steppedHeaderWidth(data.rowFields.map((r) => r.proj.queryRef), f.widthByRef) ?? f.cornerWidth
  }
  function leafRef(li: number): string | undefined {
    return (data?.values[layout.leaves[li].valueIndex] ?? data?.values[0])?.proj.queryRef
  }
  /** column level a total column totals (its own group's children; the grand total: the first level) */
  function totalLevel(li: number) {
    const leaf = layout.leaves[li]
    return leaf.isTotal && !leaf.collapsed ? data.colFields[Math.min(leaf.path.length, data.colFields.length - 1)] : undefined
  }
  /** "More granular": the selector of one column header (its level's value) or one total column, as Power BI writes it */
  function leafTarget(li: number): WidthTarget | undefined {
    const leaf = layout.leaves[li]
    const multi = data.values.length > 1 && leaf.valueIndex >= 0 ? { metadata: leafRef(li) } : {}
    const total = totalLevel(li)
    if (total) return { data: totalSelector(total.proj.expr), ...multi }
    const k = leaf.path.length
    return k && data.colFields[k - 1] ? { data: scopeSelector(data.colFields[k - 1].proj.expr, leaf.path[k - 1]), ...multi } : undefined
  }
  /** custom width of a leaf column: its own column header / total column first, then the uniform width of its value */
  function leafWidth(li: number): number | undefined {
    const ref = leafRef(li)
    const path = layout.leaves[li].path.map((value, i) => ({ expr: data.colFields[i].proj.expr, value }))
    return scopedWidth(f.widthByScope, { ref, path, totalOf: totalLevel(li)?.proj.expr }) ?? (ref ? f.widthByRef.get(ref) : undefined)
  }

  if (view.error) return <Message text={`Couldn't load the data for this visual. ${view.error}`} />
  if (!data || (!data.values.length && !rowLevels && !data.colFields.length)) return <Message text="Add data fields to Rows, Columns or Values to build a matrix." muted />

  function leafHeaderText(li: number): string {
    const leaf = layout.leaves[li]
    if (leaf.valueIndex >= 0 && layout.showValueHeaders) return data.values[leaf.valueIndex]?.label ?? ''
    if (leaf.isTotal && !leaf.collapsed && leaf.totalKind !== 'subtotal') return data.spec.colTotalLabel?.(0) ?? 'Total'
    if (leaf.isTotal && !leaf.collapsed) return data.spec.colTotalLabel?.(leaf.path.length) ?? 'Total'
    const last = leaf.path.length - 1
    return last >= 0 ? formatLabel(ctx, leaf.path[last], data.colFields[last]?.formatString, data.colFields[last]?.dataType) : data.values[0]?.label ?? ''
  }

  const colWidths = preview ? widths.map((w, i) => (i === preview.col ? preview.width : w)) : widths
  const xs: number[] = []
  colWidths.reduce((acc, w, i) => ((xs[i] = acc), acc + w), 0)
  const totalWidth = colWidths.reduce((a, b) => a + b, 0)
  const frozenWidth = colWidths.slice(0, rowHeaderCols).reduce((a, b) => a + b, 0)
  const pad = f.grid.rowPadding
  const rowH = Math.ceil(Math.max(valuePx, rowHeaderPx) * 1.36) + pad * 2
  const outline = (o: Parameters<typeof outlineBorders>[0]) => outlineBorders(o, f.grid.outlineColor, f.grid.outlineWeight)
  const selected = new Set(ctx.selection.map(identityKey))
  const colButtonColor = f.header.buttons.color ?? f.header.font.color

  // ---------------- column widths ----------------
  const editable = ctx.mode === 'edit'
  const granular = f.sizing.granular && data.colFields.length > 0
  const fitWidth = (ci: number) => contentWidth(widthInputs[ci], widthOptions)
  /** custom width of a row-header column (stored under its row field, like Power BI) */
  const resizeRowHeader = (ci: number, w: number) =>
    ctx.updateVisual((j) => {
      const bag = visualObjects(j)
      const target = rowHeaderTarget(ci)
      setColumnWidth(bag, target, w)
      // a width stored under the corner column is replaced by the row field's
      if (stepped && target.metadata) resetColumnWidth(bag, { id: 'cornerColumn' })
    })
  /** custom width of a value column: uniform for the value, or for one column header / total column with "More granular" */
  const resizeLeaf = (li: number, w: number) => {
    const ref = leafRef(li)
    const target = granular ? leafTarget(li) : undefined
    if (!ref && !target) return
    ctx.updateVisual((j) => {
      const bag = visualObjects(j)
      if (target) return setColumnWidth(bag, target, w)
      setColumnWidth(bag, ref!, w)
      clearScopedWidths(bag, ref)
    })
  }
  const askWidth = (label: string, current: number, apply: (w: number) => void) =>
    void promptDialog({ title: 'Set column width', label: `Width of "${label}" (pixels)`, value: String(Math.round(current)), validate: validWidth }).then((v) => {
      if (v !== null) apply(Number(v))
    })
  const rowHeaderWidthEntries = (ci: number): ContextMenuEntry[] => {
    if (!editable) return []
    return [
      { label: 'Set column width', onClick: () => askWidth((stepped ? data.rowFields[0]?.label : data.rowFields[ci]?.label) || 'Row headers', widths[ci], (w) => resizeRowHeader(ci, w)) },
      {
        label: 'Reset column width',
        disabled: rowHeaderWidth(ci) === undefined,
        onClick: () =>
          ctx.updateVisual((j) => {
            const bag = visualObjects(j)
            resetColumnWidth(bag, rowHeaderTarget(ci))
            if (!stepped) return
            // stepped layout: older files keep the width under another row level or the corner column
            for (const r of data.rowFields) resetColumnWidth(bag, r.proj.queryRef)
            resetColumnWidth(bag, { id: 'cornerColumn' })
          })
      }
    ]
  }
  const leafWidthEntries = (li: number): ContextMenuEntry[] => {
    const ref = leafRef(li)
    if (!editable || !ref) return []
    return [
      { label: 'Set column width', onClick: () => askWidth(view.leafLabels[li], widths[rowHeaderCols + li], (w) => resizeLeaf(li, w)) },
      {
        label: 'Reset column width',
        disabled: leafWidth(li) === undefined,
        onClick: () =>
          ctx.updateVisual((j) => {
            const bag = visualObjects(j)
            // this column header's own width; without "More granular" also the uniform width of the value
            const own = leafTarget(li)
            if (own) {
              resetColumnWidth(bag, own)
              resetColumnWidth(bag, { data: own.data })
            }
            if (!granular) resetColumnWidth(bag, ref)
          })
      }
    ]
  }

  // ---------------- expand / collapse (PBIR expansionStates, see ../common/expansion) ----------------
  const rowState: ExpansionState = { levelExpanded: data.spec.rowLevelExpanded ?? [], toggled: data.spec.toggled }
  const colState: ExpansionState = { levelExpanded: data.spec.colLevelExpanded ?? [], toggled: data.spec.colToggled ?? new Set() }
  const levelsOf = (fields: typeof data.rowFields): ExpansionLevel[] => fields.map((x) => ({ queryRef: x.proj.queryRef, expr: x.proj.expr }))
  const editExpansion = (role: 'Rows' | 'Columns', command: (e: ExpansionEdit) => void) => {
    ctx.updateVisual((j) => applyExpansion(j, role, levelsOf(role === 'Rows' ? data.rowFields : data.colFields), role === 'Rows' ? rowState : colState, command))
    // the saved state now includes what "Expand all down one level" forced at run time
    if (role === 'Rows' && ctx.drill.expandedLevel !== undefined) ctx.setDrill({ ...ctx.drill, expandedLevel: undefined })
    if (role === 'Columns' && ctx.drill.columnExpandedLevel !== undefined) ctx.setDrill({ ...ctx.drill, columnExpandedLevel: undefined })
  }
  /** Power BI's Expand ▸ / Collapse ▸ (Selection · Entire level · All) for a row or column header */
  const expansionEntries = (role: 'Rows' | 'Columns', path: Scalar[]): ContextMenuEntry[] => {
    const state = role === 'Rows' ? rowState : colState
    const levels = state.levelExpanded.length
    if (levels < 2 || !path.length) return []
    const level = path.length - 1
    const canExpand = level < levels - 1
    const open = canExpand && isExpanded(state, path)
    const sub = (expanded: boolean): ContextMenuEntry[] => [
      { label: 'Selection', disabled: !canExpand || open === expanded, onClick: () => editExpansion(role, (e) => setNodeExpanded(e, path, expanded)) },
      { label: 'Entire level', disabled: !canExpand, onClick: () => editExpansion(role, (e) => setLevelExpanded(e, level, expanded)) },
      { label: 'All', onClick: () => editExpansion(role, (e) => setAllExpanded(e, expanded)) }
    ]
    return [
      { label: 'Expand', items: sub(true) },
      { label: 'Collapse', items: sub(false) }
    ]
  }
  const freezeEntries = (): ContextMenuEntry[] =>
    rowHeaderCols ? [{ label: frozen ? 'Unfreeze row headers' : 'Freeze row headers', onClick: () => setFrozenView({ saved: savedFrozen, frozen: !frozen }) }] : []
  /** entries of a matrix menu: the clicked header's own, then the transient freeze switch */
  const withFreeze = (own: ContextMenuEntry[]): ContextMenuEntry[] => {
    const fz = freezeEntries()
    return own.length && fz.length ? [...own, { separator: true }, ...fz] : [...own, ...fz]
  }
  /** selected rows as TSV with headers (Copy ▸ Copy selection, Ctrl+C); undefined without a selection */
  const selectionText = (): string | undefined => {
    const rowIdx = layout.items.map((it, i) => ({ it, i })).filter(({ it }) => it.kind === 'node' && selected.has(identityKey(matrixIdentity(data, it.path))))
    if (!rowIdx.length) return undefined
    const headers = ['', ...layout.leaves.map((_, li) => view.leafLabels[li])]
    return toTsv(headers, rowIdx.map(({ i }) => [view.rowLabels[i], ...cells[i].map((c) => c.text)]))
  }

  // ---------------- header ----------------
  const headerLine = Math.ceil(ptToPx(f.header.font.size) * 1.36)
  const headerRowCount = Math.max(1, layout.headerRows.length)
  const sortEntry = (json?.visual?.query?.sortDefinition?.sort ?? [])[0]
  const sortKeyOf = (expr: any): 'asc' | 'desc' | undefined =>
    sortEntry && JSON.stringify(sortEntry.field) === JSON.stringify(expr) ? (sortEntry.direction === 'Descending' ? 'desc' : 'asc') : undefined
  /** lines a header text takes in a cell `w` px wide (word wrap: up to 3) */
  const headerLines = (t: string, w: number) => (f.header.wordWrap ? Math.max(1, Math.min(3, Math.ceil(measureText(t, f.header.font) / Math.max(20, w - 2 * CELL_PAD_X)))) : 1)
  const headerRowHeights = Array.from({ length: headerRowCount }, (_, r) => {
    let h = headerLine
    for (const cell of layout.headerRows[r] ?? []) {
      const w = colWidths.slice(rowHeaderCols + cell.start, rowHeaderCols + cell.start + cell.colSpan).reduce((a, b) => a + b, 0)
      const v = cell.kind === 'value' ? data.values[cell.valueIndex ?? 0] : undefined
      // the sort caret takes a line of its own below the text (HeaderLabel)
      const caret = v && sortKeyOf(v.proj.expr) ? SORT_CARET_H : 0
      h = Math.max(h, headerLines(headerCellText(cell), w) * headerLine + caret)
    }
    // corner cells of the last header row: the row field name(s), with their own sort caret
    if (r === headerRowCount - 1) {
      for (let ci = 0; ci < rowHeaderCols; ci++) {
        const field = stepped ? data.rowFields[0] : data.rowFields[ci]
        if (!field) continue
        const caret = sortKeyOf(field.proj.expr) ? SORT_CARET_H : 0
        h = Math.max(h, headerLines(field.label ?? '', colWidths[ci]) * headerLine + caret)
      }
    }
    return h + pad * 2
  })
  if (!layout.headerRows.length) headerRowHeights[0] = headerLine + pad * 2
  const headerHeight = headerRowHeights.reduce((a, b) => a + b, 0)
  const headerYs: number[] = []
  headerRowHeights.reduce((acc, h, i) => ((headerYs[i] = acc), acc + h), 0)

  function headerCellText(cell: ColHeaderCell): string {
    if (cell.kind === 'value') return data.values[cell.valueIndex ?? 0]?.label ?? ''
    if (cell.kind === 'total') return String(cell.label ?? 'Total')
    const lvl = cell.path.length - 1
    return formatLabel(ctx, cell.label, data.colFields[lvl]?.formatString, data.colFields[lvl]?.dataType)
  }

  const toggleSort = (expr: any, numeric: boolean) => {
    const cur = sortKeyOf(expr)
    const direction = cur ? (cur === 'asc' ? 'Descending' : 'Ascending') : numeric ? 'Descending' : 'Ascending'
    ctx.updateVisual((j) => applySort(j, { field: expr, direction }))
  }

  const headerBg = f.header.background ?? f.values.backPrimary
  const headerCells: ReactNode[] = []
  // corner cells live in one sticky (frozen) box so they stay put while scrolling horizontally
  const cornerCells: ReactNode[] = []
  // corner: column field names on the upper header rows, row field name(s) on the last one
  const cornerRows = headerRowCount
  for (let r = 0; r < cornerRows; r++) {
    const last = r === cornerRows - 1
    const colName = !last && r < layout.colHeaderLevels ? data.colFields[r]?.label ?? '' : undefined
    const y = headerYs[r] ?? 0
    const h = headerRowHeights[r] ?? headerHeight
    if (!last) {
      if (!rowHeaderCols) continue
      cornerCells.push(
        <div key={`cornerT${r}`} style={{ ...headerCellBase(0, y, frozenWidth, h), justifyContent: 'flex-start' }}>
          <span style={headerTextStyle(f.header.wordWrap)}>{colName}</span>
        </div>
      )
      continue
    }
    for (let ci = 0; ci < rowHeaderCols; ci++) {
      const field = stepped ? data.rowFields[0] : data.rowFields[ci]
      const label = stepped ? data.rowFields.map((rf) => rf.label)[0] ?? '' : field?.label ?? ''
      const dir = field ? sortKeyOf(field.proj.expr) : undefined
      const cornerAlign = f.header.titleAlignment ?? f.header.alignment ?? 'left'
      cornerCells.push(
        <div
          key={`corner${ci}`}
          style={{
            ...headerCellBase(xs[ci], y, colWidths[ci], h),
            justifyContent: cornerAlign === 'center' ? 'center' : cornerAlign === 'right' ? 'flex-end' : 'flex-start',
            ...((ci < rowHeaderCols - 1 || layout.leaves.length > 0) && !f.grid.vertical ? headerSeparator(f.header.font.color) : {}),
            cursor: field ? 'pointer' : undefined
          }}
          data-col={rowHeaderTarget(ci).metadata ?? 'cornerColumn'}
          role="columnheader"
          onClick={() => field && toggleSort(field.proj.expr, false)}
          onContextMenu={(e) => {
            e.preventDefault()
            ctx.showContextMenu({ x: e.clientX, y: e.clientY, target: 'header', value: label, selectionText, entries: withFreeze(rowHeaderWidthEntries(ci)) })
          }}
        >
          <HeaderLabel text={label} align={cornerAlign} sort={dir} color={f.header.font.color} textStyle={headerTextStyle(f.header.wordWrap, cornerAlign)} />
          {editable ? (
            <ResizeHandle
              width={colWidths[ci]}
              label={label}
              onPreview={(w) => setPreview(w === undefined ? undefined : { col: ci, width: w })}
              onResize={(w) => resizeRowHeader(ci, w)}
              onAutoFit={() => resizeRowHeader(ci, fitWidth(ci))}
            />
          ) : null}
        </div>
      )
    }
  }
  const onToggleColumn = (cell: ColHeaderCell) => editExpansion('Columns', (e) => setNodeExpanded(e, cell.path, !cell.expanded))
  const onColumnHeaderClick = (e: React.MouseEvent, cell: ColHeaderCell) => {
    if (cell.kind !== 'group') return
    const drill = ctx.drill
    // drill mode + "Drill on: Columns" (host-provided) drills into the column group
    if (drill.drillMode && drill.target === 'columns' && cell.canExpand) {
      const id = matrixIdentity(data, [], cell.path)
      ctx.setDrill({ ...drill, columnLevel: data.colOffset + cell.path.length, path: [...drill.path, { fields: id.fields.slice(-1) }], columnExpandedLevel: undefined })
      return
    }
    // single value: clicking a column header sorts the rows by the value (Power BI sorts by the measure)
    if (data.values.length === 1 && !data.values[0].sparkline) {
      toggleSort(data.values[0].proj.expr, true)
      return
    }
    void e
  }
  layout.headerRows.forEach((row, r) =>
    row.forEach((cell, k) => {
      const ci = rowHeaderCols + cell.start
      const w = colWidths.slice(ci, ci + cell.colSpan).reduce((a, b) => a + b, 0)
      const h = headerRowHeights.slice(r, r + cell.rowSpan).reduce((a, b) => a + b, 0)
      const isValue = cell.kind === 'value'
      const v = isValue ? data.values[cell.valueIndex ?? 0] : undefined
      const dir = v ? sortKeyOf(v.proj.expr) : undefined
      const leafCell = !isValue && cell.colSpan === (layout.showValueHeaders ? Math.max(1, data.values.length) : 1) && !cell.canExpand
      // value / leaf headers: the header alignment (Auto = left, like Power BI renders); upper column-group levels: the title alignment
      const align = isValue ? (v?.sparkline && !f.header.alignment ? 'center' : headerAlignment(f, v ? f.columnOverrides.get(v.proj.queryRef) : undefined)) : cell.kind === 'total' || leafCell ? headerAlignment(f) : f.header.titleAlignment ?? f.header.alignment ?? 'left'
      const lastCol = cell.start + cell.colSpan >= layout.leaves.length
      const isGrand = cell.kind === 'total' && cell.path.length === 0
      const totalStyle: TotalStyle | undefined = cell.kind === 'total' ? (isGrand ? f.columnTotal : f.subTotals.columnStyle) : undefined
      const bold = cell.kind === 'total' || !!cell.isSubtotalLevel
      const font: FontSpec = totalStyle?.applyToHeaders ? totalStyle.font : { ...f.header.font, bold: f.header.font.bold || bold }
      const text = headerCellText(cell)
      headerCells.push(
        <div
          key={`h${r}_${k}`}
          style={{
            ...headerCellBase(xs[ci], headerYs[r], w, h),
            ...fontStyle(font),
            background: totalStyle?.applyToHeaders && totalStyle.background ? totalStyle.background : headerBg,
            // Power BI top-aligns header text (a one-line header next to wrapped ones sits on the first line)
            alignItems: 'flex-start',
            ...(!lastCol && !f.grid.vertical ? headerSeparator(font.color) : {}),
            justifyContent: align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start',
            gap: 4,
            cursor: isValue || (cell.kind === 'group' && data.values.length === 1) ? 'pointer' : undefined,
            borderBottom: r < headerRowCount - 1 && f.grid.horizontal ? `1px solid ${f.grid.horizontalColor}` : undefined
          }}
          data-col={cell.colSpan === 1 ? leafRef(cell.start) : undefined}
          data-align={align}
          role="columnheader"
          onClick={(e) => (v ? toggleSort(v.proj.expr, true) : onColumnHeaderClick(e, cell))}
          onContextMenu={(e) => {
            e.preventDefault()
            const entries = [...(cell.kind === 'group' ? expansionEntries('Columns', cell.path) : []), ...(cell.colSpan === 1 ? leafWidthEntries(cell.start) : [])]
            const id = cell.kind === 'group' && cell.path.length ? matrixIdentity(data, [], cell.path) : undefined
            ctx.showContextMenu({ x: e.clientX, y: e.clientY, identity: id, target: cell.kind === 'total' ? 'total' : 'header', value: text, selectionText, entries: withFreeze(entries) })
          }}
          title={text}
        >
          {showColButtons && cell.kind === 'group' && cell.canExpand ? (
            <ExpandButton
              expanded={!!cell.expanded}
              size={colButtonPx}
              color={colButtonColor}
              linePx={ptToPx(font.size)}
              onClick={(e) => {
                e.stopPropagation()
                onToggleColumn(cell)
              }}
            />
          ) : null}
          <HeaderLabel text={text} align={align} sort={dir} color={f.header.font.color} textStyle={headerTextStyle(f.header.wordWrap, align)} />
          {editable && cell.colSpan === 1 && cell.start + cell.colSpan <= layout.leaves.length && leafRef(cell.start) && r + cell.rowSpan === headerRowCount ? (
            <ResizeHandle
              width={w}
              label={text}
              onPreview={(nw) => setPreview(nw === undefined ? undefined : { col: ci, width: nw })}
              onResize={(nw) => resizeLeaf(cell.start, nw)}
              onAutoFit={() => resizeLeaf(cell.start, fitWidth(ci))}
            />
          ) : null}
        </div>
      )
    })
  )
  if (!layout.headerRows.length) {
    // values on rows without column fields: a single "Values"-less header line
    layout.leaves.forEach((_leaf, li) => {
      const ci = rowHeaderCols + li
      headerCells.push(<div key={`hv${li}`} style={headerCellBase(xs[ci], 0, colWidths[ci], headerHeight)} />)
    })
  }

  function headerCellBase(x: number, y: number, w: number, h: number): CSSProperties {
    return {
      position: 'absolute',
      left: x,
      top: y,
      width: w,
      height: h,
      padding: `${pad}px ${cellPadX(w)}px`,
      display: 'flex',
      alignItems: 'flex-start',
      overflow: 'hidden',
      boxSizing: 'border-box',
      ...fontStyle(f.header.font),
      background: headerBg,
      borderRight: f.grid.vertical ? `${f.grid.verticalWeight}px solid ${f.grid.verticalColor}` : undefined
    }
  }

  const header = (
    <div style={{ position: 'relative', height: headerHeight, width: totalWidth, background: headerBg, ...outline(f.header.outline) }}>
      {rowHeaderCols ? (
        <div style={{ position: frozen ? 'sticky' : 'absolute', left: 0, top: 0, width: frozenWidth, height: headerHeight, zIndex: 2, background: headerBg }}>{cornerCells}</div>
      ) : null}
      {headerCells}
    </div>
  )

  // ---------------- body ----------------
  const buttonColor = f.rowHeaders.buttonColor ?? f.rowHeaders.font.color
  const totalStyleFor = (it: RowItem): TotalStyle | undefined => (it.totalKind === 'grand' ? f.rowTotal : it.isTotal ? f.subTotals.style : undefined)
  const rowFontFor = (it: RowItem): FontSpec => {
    const ts = totalStyleFor(it)
    if (ts?.applyToHeaders) return ts.font
    if (ts) return { ...f.rowHeaders.font, bold: f.rowHeaders.font.bold || ts.font.bold }
    return f.rowHeaders.font
  }
  const valueFontFor = (it: RowItem, leafKind: 'subtotal' | 'grand' | undefined, odd: boolean): FontSpec => {
    const base = { ...f.values.font, color: odd ? f.values.fontColorSecondary : f.values.font.color }
    if (it.totalKind === 'grand') return f.rowTotal.font
    if (leafKind === 'grand') return f.columnTotal.font
    if (it.isTotal) return f.subTotals.style.font
    if (leafKind === 'subtotal') return f.subTotals.columnStyle.font
    return base
  }

  const onToggle = (it: RowItem) => editExpansion('Rows', (e) => setNodeExpanded(e, it.path, !it.node?.expanded))
  const onRowHeaderClick = (e: React.MouseEvent, it: RowItem) => {
    if (it.kind !== 'node' || !it.node) return
    const id = matrixIdentity(data, it.path)
    const drill = ctx.drill
    if (drill.drillMode && drill.target !== 'columns' && it.node.canExpand) {
      ctx.setDrill({ ...ctx.drill, level: data.rowOffset + it.path.length, path: [...ctx.drill.path, { fields: id.fields.slice(-1) }], expandedLevel: undefined })
      return
    }
    selectId(e, id)
  }
  const selectId = (e: React.MouseEvent, id: ReturnType<typeof matrixIdentity>) => {
    if (!id.fields.length) return
    const k = identityKey(id)
    const multi = e.ctrlKey || e.metaKey
    if (selected.has(k) && (multi || selected.size === 1)) ctx.select(ctx.selection.filter((s) => identityKey(s) !== k))
    else ctx.select(multi ? [...ctx.selection, id] : [id], { multi })
  }

  const copySelection = () => {
    let text = selectionText()
    if (text === undefined && lastCell.current) {
      const { row, col } = lastCell.current
      text = col < 0 ? view.rowLabels[row] : cells[row]?.[col]?.text
    }
    if (text !== undefined) void copyToClipboard(text)
  }

  const blankRowStyle = (): CSSProperties => {
    const b = f.blankRows
    const line = `${b.borderWidth}px solid ${b.borderColor}`
    return {
      background: b.color ?? f.values.backPrimary,
      ...(b.border && b.borderPosition !== 'Bottom' ? { borderTop: line } : {}),
      ...(b.border && b.borderPosition !== 'Top' ? { borderBottom: line } : {})
    }
  }

  const renderRow = (i: number, style: CSSProperties, ref: (el: HTMLElement | null) => void) => {
    const it = layout.items[i]
    if (it.kind === 'blank') {
      return <div key={i} ref={ref} style={{ ...style, height: rowH, ...blankRowStyle() }} />
    }
    const odd = i % 2 === 1
    const ts = totalStyleFor(it)
    const bandBg = odd ? f.values.backSecondary : f.values.backPrimary
    const bg = ts?.background ?? (it.isTotal ? f.values.backPrimary : bandBg)
    const rhBg = (ts?.applyToHeaders ? ts.background : undefined) ?? f.rowHeaders.background ?? (f.values.bandedRowHeaders ? bg : f.values.backPrimary)
    const rowSel = it.kind === 'node' && selected.size > 0 && selected.has(identityKey(matrixIdentity(data, it.path)))
    const rhFont = rowFontFor(it)
    const label = view.rowLabels[i]
    const rowField = it.kind === 'node' ? data.rowFields[it.path.length - 1] : undefined
    const labelUrl = rowField && (rowField.dataCategory ?? '').toLowerCase() === 'weburl' && isUrl(it.label) ? String(it.label).trim() : undefined
    const rowHeaderNodes: ReactNode[] = []
    const headerCol = stepped ? 0 : itemColumn(it, rowLevels)
    for (let ci = 0; ci < rowHeaderCols; ci++) {
      const isLabelCol = ci === headerCol
      const lastHeaderCol = ci === rowHeaderCols - 1
      rowHeaderNodes.push(
        <div
          key={`rh${ci}`}
          style={{
            position: frozen ? 'sticky' : 'relative',
            left: frozen ? xs[ci] : undefined,
            zIndex: 1,
            flex: `0 0 ${colWidths[ci]}px`,
            width: colWidths[ci],
            padding: `${pad}px ${CELL_PAD_X}px`,
            paddingLeft: CELL_PAD_X + (stepped ? it.level * f.rowHeaders.indentation : 0),
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: f.rowHeaders.alignment === 'right' ? 'flex-end' : f.rowHeaders.alignment === 'center' ? 'center' : 'flex-start',
            gap: 4,
            overflow: 'hidden',
            boxSizing: 'border-box',
            background: rhBg,
            ...fontStyle(rhFont),
            ...(lastHeaderCol ? outline(f.rowHeaders.outline) : {}),
            ...(f.grid.vertical && !lastHeaderCol ? { borderRight: `${f.grid.verticalWeight}px solid ${f.grid.verticalColor}` } : {}),
            cursor: it.kind === 'node' ? 'pointer' : undefined,
            boxShadow: rowSel ? 'inset 0 0 0 9999px rgba(17,141,255,0.10)' : undefined
          }}
          onMouseDown={() => (lastCell.current = { row: i, col: -1 })}
          onClick={(e) => onRowHeaderClick(e, it)}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
            const node = it.kind === 'node'
            ctx.showContextMenu({
              x: e.clientX,
              y: e.clientY,
              identity: node ? matrixIdentity(data, it.path) : undefined,
              target: node ? 'header' : it.isTotal ? 'total' : 'empty',
              value: label,
              selectionText,
              entries: withFreeze(node ? expansionEntries('Rows', it.path) : [])
            })
          }}
        >
          {isLabelCol && showButtons ? (
            it.kind === 'node' && it.node?.canExpand ? (
              <ExpandButton
                expanded={!!it.node.expanded}
                size={buttonPx}
                color={buttonColor}
                linePx={rowHeaderPx}
                onClick={(e) => {
                  e.stopPropagation()
                  onToggle(it)
                }}
              />
            ) : (it.kind === 'node' || it.kind === 'value') && (stepped || it.path.length < rowLevels) ? (
              // keep labels aligned with expandable siblings; outline/tabular leaf columns have no icons
              <span style={{ flex: `0 0 ${buttonPx}px` }} />
            ) : null
          ) : null}
          {isLabelCol ? (
            labelUrl ? (
              <span
                title={labelUrl}
                onClick={(e) => {
                  e.stopPropagation()
                  ctx.actions.openUrl(labelUrl)
                }}
                style={{ cursor: 'pointer', textDecoration: f.rowHeaders.urlIcon ? undefined : 'underline', color: f.rowHeaders.urlIcon ? '#118DFF' : undefined }}
              >
                {f.rowHeaders.urlIcon ? <LinkIcon size={rowHeaderPx} /> : label}
              </span>
            ) : (
              <span style={f.rowHeaders.wordWrap ? { whiteSpace: 'normal', overflowWrap: 'anywhere' } : { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
            )
          ) : null}
        </div>
      )
    }
    return (
      <div
        key={i}
        ref={ref}
        style={{
          ...style,
          display: 'flex',
          minHeight: rowH,
          background: bg,
          borderBottom: f.grid.horizontal ? `${f.grid.horizontalWeight}px solid ${f.grid.horizontalColor}` : undefined
        }}
      >
        {rowHeaderNodes}
        {cells[i].map((cell, li) => {
          const leaf = layout.leaves[li]
          const ci = rowHeaderCols + li
          const font = valueFontFor(it, leaf.totalKind ?? (leaf.isTotal ? 'subtotal' : undefined), odd)
          const v = data.values[data.spec.valuesOnRow ? it.valueIndex ?? 0 : leaf.valueIndex]
          const ov = v ? f.columnOverrides.get(v.proj.queryRef) : undefined
          const align = ov?.alignment ?? (cell.spark ? 'center' : typeof cell.value === 'number' || !cell.text ? 'right' : 'left')
          const colTotalBg = leaf.totalKind === 'grand' ? f.columnTotal.background : leaf.isTotal ? f.subTotals.columnStyle.background : undefined
          return (
            <div
              key={li}
              style={{
                position: 'relative',
                flex: `0 0 ${colWidths[ci]}px`,
                width: colWidths[ci],
                padding: `${pad}px ${cellPadX(colWidths[ci])}px`,
                display: 'flex',
                alignItems: cell.spark ? 'center' : undefined,
                overflow: 'hidden',
                boxSizing: 'border-box',
                ...fontStyle(font),
                color: cell.color ?? font.color,
                background: cell.background ?? colTotalBg,
                borderRight: f.grid.vertical && li < cells[i].length - 1 ? `${f.grid.verticalWeight}px solid ${f.grid.verticalColor}` : undefined
              }}
              onMouseDown={() => (lastCell.current = { row: i, col: li })}
              onClick={(e) => it.kind === 'node' && selectId(e, matrixIdentity(data, it.path, leaf.path))}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                const id = it.kind === 'node' || it.kind === 'value' ? matrixIdentity(data, it.path, leaf.path) : undefined
                ctx.showContextMenu({ x: e.clientX, y: e.clientY, identity: id?.fields.length ? id : undefined, target: it.isTotal || leaf.isTotal ? 'total' : 'dataPoint', value: copyValueText(cell), selectionText, entries: withFreeze([]) })
              }}
              onMouseMove={(e) =>
                cell.text
                  ? ctx.showTooltip({
                      x: e.clientX,
                      y: e.clientY,
                      items: [
                        ...it.path.map((pv, pi) => ({ label: data.rowFields[pi].label, value: formatLabel(ctx, pv, data.rowFields[pi].formatString, data.rowFields[pi].dataType) })),
                        ...leaf.path.map((pv, pi) => ({ label: data.colFields[pi].label, value: formatLabel(ctx, pv, data.colFields[pi].formatString, data.colFields[pi].dataType) })),
                        { label: v?.label ?? '', value: cell.text }
                      ]
                    })
                  : undefined
              }
              onMouseLeave={() => ctx.showTooltip(null)}
            >
              <CellContent
                cell={cell}
                align={align}
                wrap={f.values.wordWrap && !it.isTotal}
                fontPx={valuePx}
                urlIcon={f.values.urlIcon}
                imageHeight={f.grid.imageHeight}
                imageWidth={f.grid.imageWidth}
                contentWidth={colWidths[ci] - 2 * CELL_PAD_X}
                onOpenUrl={(u) => ctx.actions.openUrl(u)}
              />
            </div>
          )
        })}
      </div>
    )
  }

  // the row grand total stays pinned to the bottom of the visual while the body scrolls (Power BI)
  const pinFrom = pinnedGrandTotalStart(layout.items)
  const gridWidth = Math.max(totalWidth, frozenWidth)
  const footer =
    pinFrom < layout.items.length ? (
      <div data-role="grand-total">{layout.items.slice(pinFrom).map((_, k) => renderRow(pinFrom + k, { position: 'relative', width: gridWidth }, () => undefined))}</div>
    ) : undefined

  return (
    <div
      style={{ width, height, position: 'relative', outline: 'none' }}
      tabIndex={-1}
      onMouseDown={(e) => (e.currentTarget as HTMLDivElement).focus({ preventScroll: true })}
      onKeyDown={(e) => {
        if (isCopyKey(e)) {
          e.preventDefault()
          copySelection()
        }
      }}
    >
      <Grid
        width={width}
        height={height}
        totalWidth={gridWidth}
        rowCount={pinFrom}
        estimateRowHeight={rowH}
        measure={f.values.wordWrap || f.rowHeaders.wordWrap}
        background={f.values.backPrimary}
        bodyStyle={outline(f.values.outline)}
        header={header}
        footer={footer}
        renderRow={renderRow}
        onNearEnd={data?.hasMore ? loadMore : undefined}
        nearEndThreshold={LOAD_MORE_THRESHOLD}
        onNearRightEnd={data?.columnsCapped ? loadMoreColumns : undefined}
        nearRightThresholdPx={LOAD_MORE_COLUMNS_PX}
        onViewportWidth={setViewport}
      />
    </div>
  )
}

/** Non-stepped layouts: which row-header column holds the item's label. */
function itemColumn(it: RowItem, rowLevels: number): number {
  if (it.kind === 'value') return rowLevels
  if (it.kind === 'grand' || it.kind === 'blank') return 0
  return Math.max(0, it.level)
}

function headerTextStyle(wrap: boolean, align: 'left' | 'center' | 'right' = 'left'): CSSProperties {
  return wrap
    ? { whiteSpace: 'normal', overflowWrap: 'anywhere', textAlign: align, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }
    : { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
}

/**
 * Width of the stepped-layout row-header column. PBI persists a resized stepped row header under the
 * outermost row field's `columnWidth` selector; reports converted from tabular layout may only carry
 * widths for deeper levels — use the first visible level's width, else the widest saved row-field width.
 */
export function steppedHeaderWidth(rowRefs: string[], widthByRef: Map<string, number>): number | undefined {
  const first = rowRefs.length ? widthByRef.get(rowRefs[0]) : undefined
  if (first !== undefined) return first
  const all = rowRefs.map((r) => widthByRef.get(r)).filter((w): w is number => w !== undefined)
  return all.length ? Math.max(...all) : undefined
}

/** Power BI's +/- expand/collapse icon: a small rounded square with a minus / plus. */
function ExpandButton({ expanded, size, color, linePx, onClick }: { expanded: boolean; size: number; color: string; linePx: number; onClick(e: React.MouseEvent): void }) {
  const s = Math.max(8, size)
  return (
    <span
      role="button"
      aria-label={expanded ? 'Collapse' : 'Expand'}
      onClick={onClick}
      style={{ flex: `0 0 ${s}px`, height: s, marginTop: Math.max(0, (linePx * 1.36 - s) / 2), cursor: 'pointer', display: 'inline-flex', alignSelf: 'flex-start' }}
    >
      <svg width={s} height={s} viewBox="0 0 10 10">
        <rect x="0.6" y="0.6" width="8.8" height="8.8" rx="1.4" fill="none" stroke={color} strokeWidth="0.8" />
        <path d="M2.8 5 H7.2" stroke={color} strokeWidth="0.9" />
        {expanded ? null : <path d="M5 2.8 V7.2" stroke={color} strokeWidth="0.9" />}
      </svg>
    </span>
  )
}

export { maxTextWidth }
