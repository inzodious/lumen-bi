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
import type { VisualProps } from '../contract'
import { fontStyle, measureText, ptToPx, type FontSpec } from '../common/textStyle'
import { CellContent, Grid, LinkIcon, ResizeHandle, SortCaret } from './Grid'
import { buildMatrixView, formatLabel, matrixIdentity } from './matrixView'
import { toggleExpansion } from './matrixQuery'
import { applySort } from './tableModel'
import { outlineBorders, scopeMatches, type TotalStyle } from './tableFormat'
import { computeWidths, CELL_PAD_X, maxTextWidth } from './widths'
import { setColumnWidth, Message, AUTOSIZE_SAMPLE_ROWS } from './TableVisual'
import type { ColHeaderCell, RowItem } from './matrixModel'
import { copyToClipboard, isCopyKey, toTsv } from './copy'
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
  const frozen = !f.rowHeaders.unfrozen

  const widths = useMemo(() => {
    if (!data) return []
    const maxLevel = Math.max(0, ...layout.items.map((i) => i.level))
    const sample = layout.items.slice(0, AUTOSIZE_SAMPLE_ROWS)
    const headerInputs = Array.from({ length: rowHeaderCols }, (_, ci) => {
      const texts = sample.flatMap((it, i) => (stepped || itemColumn(it, rowLevels) === ci ? [view.rowLabels[i]] : []))
      const name = stepped ? data.rowFields.map((r) => r.label)[0] ?? '' : data.rowFields[ci]?.label ?? ''
      return {
        header: name,
        headerFont: f.header.font,
        texts,
        valueFont: { ...f.rowHeaders.font, bold: true },
        explicit: f.cornerWidth ?? (stepped ? steppedHeaderWidth(data.rowFields.map((r) => r.proj.queryRef), f.widthByRef) : f.widthByRef.get(data.rowFields[ci]?.proj.queryRef ?? '')),
        extra: (stepped ? maxLevel * f.rowHeaders.indentation : 0) + (showButtons ? buttonPx + 6 : 0)
      }
    })
    const leafInputs = layout.leaves.map((leaf, li) => {
      const v = data.values[leaf.valueIndex] ?? data.values[0]
      const scoped = f.widthByScope.find((w) =>
        scopeMatches(
          w.scope,
          leaf.path.map((value, i) => ({ expr: data.colFields[i].proj.expr, value }))
        )
      )
      const spark = data.spec.valuesOnRow ? data.values.some((x) => x.sparkline) : !!v?.sparkline
      return {
        header: leafHeaderText(li),
        headerFont: { ...f.header.font, bold: f.header.font.bold || leaf.isTotal },
        texts: spark && !data.spec.valuesOnRow ? [] : cells.slice(0, AUTOSIZE_SAMPLE_ROWS).map((r) => r[li].text),
        valueFont: { ...f.values.font, bold: f.values.font.bold || leaf.isTotal },
        explicit: scoped?.width ?? (v ? f.widthByRef.get(v.proj.queryRef) : undefined),
        extra: (v?.cf?.icon ? valuePx + 4 : 0) + (showColButtons && leaf.collapsed ? colButtonPx + 6 : 0),
        minWidth: spark ? SPARKLINE_DEFAULT_WIDTH : undefined
      }
    })
    return computeWidths([...headerInputs, ...leafInputs], {
      autoSize: f.header.autoSize,
      defaultWidth: f.header.defaultWidth,
      wrapHeader: f.header.wordWrap,
      available: width,
      adjustment: f.header.columnAdjustment
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, width])

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

  // ---------------- header ----------------
  const headerLine = Math.ceil(ptToPx(f.header.font.size) * 1.36)
  const headerRowCount = Math.max(1, layout.headerRows.length)
  const headerRowHeights = Array.from({ length: headerRowCount }, (_, r) => {
    let lines = 1
    if (f.header.wordWrap) {
      for (const cell of layout.headerRows[r] ?? []) {
        const w = colWidths.slice(rowHeaderCols + cell.start, rowHeaderCols + cell.start + cell.colSpan).reduce((a, b) => a + b, 0) - 2 * CELL_PAD_X
        const t = headerCellText(cell)
        lines = Math.max(lines, Math.min(3, Math.ceil(measureText(t, f.header.font) / Math.max(20, w))))
      }
    }
    return lines * headerLine + pad * 2
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

  const sortEntry = (json?.visual?.query?.sortDefinition?.sort ?? [])[0]
  const sortKeyOf = (expr: any) => (sortEntry && JSON.stringify(sortEntry.field) === JSON.stringify(expr) ? (sortEntry.direction === 'Descending' ? 'desc' : 'asc') : undefined)
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
      cornerCells.push(
        <div
          key={`corner${ci}`}
          style={{
            ...headerCellBase(xs[ci], y, colWidths[ci], h),
            justifyContent: f.header.titleAlignment === 'center' ? 'center' : f.header.titleAlignment === 'right' ? 'flex-end' : 'flex-start',
            cursor: field ? 'pointer' : undefined
          }}
          onClick={() => field && toggleSort(field.proj.expr, false)}
        >
          <span style={headerTextStyle(f.header.wordWrap)}>{label}</span>
          {dir ? <SortCaret dir={dir} color={f.header.font.color} /> : null}
          {ctx.mode === 'edit' ? <ResizeHandle width={colWidths[ci]} onPreview={(w) => setPreview(w === undefined ? undefined : { col: ci, width: w })} onResize={(w) => ctx.updateVisual((j) => setCorner(j, w))} /> : null}
        </div>
      )
    }
  }
  const onToggleColumn = (cell: ColHeaderCell) =>
    ctx.updateVisual((j) =>
      toggleExpansion(
        j,
        cell.path,
        data.colFields.map((c) => c.proj.queryRef),
        'Columns'
      )
    )
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
      const align = isValue ? f.header.alignment ?? (v?.sparkline ? 'center' : 'right') : cell.kind === 'total' || leafCell ? f.header.alignment ?? 'right' : f.header.titleAlignment ?? f.header.alignment ?? 'left'
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
            alignItems: cell.rowSpan > 1 ? 'flex-start' : 'flex-end',
            justifyContent: align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start',
            gap: 4,
            cursor: isValue || (cell.kind === 'group' && data.values.length === 1) ? 'pointer' : undefined,
            borderBottom: r < headerRowCount - 1 && f.grid.horizontal ? `1px solid ${f.grid.horizontalColor}` : undefined
          }}
          onClick={(e) => (v ? toggleSort(v.proj.expr, true) : onColumnHeaderClick(e, cell))}
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
          {dir && align === 'right' ? <SortCaret dir={dir} color={f.header.font.color} /> : null}
          <span style={headerTextStyle(f.header.wordWrap, align)}>{text}</span>
          {dir && align !== 'right' ? <SortCaret dir={dir} color={f.header.font.color} /> : null}
          {ctx.mode === 'edit' && cell.colSpan === 1 && (v || leafCell) ? (
            <ResizeHandle
              width={w}
              onPreview={(nw) => setPreview(nw === undefined ? undefined : { col: ci, width: nw })}
              onResize={(nw) => {
                const ref = (v ?? data.values[0])?.proj.queryRef
                if (ref) ctx.updateVisual((j) => setColumnWidth(j, ref, nw))
              }}
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
      padding: `${pad}px ${CELL_PAD_X}px`,
      display: 'flex',
      alignItems: 'flex-end',
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

  const onToggle = (it: RowItem) =>
    ctx.updateVisual((j) =>
      toggleExpansion(
        j,
        it.path,
        data.rowFields.map((r) => r.proj.queryRef)
      )
    )
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
    const rowIdx = layout.items.map((it, i) => ({ it, i })).filter(({ it }) => it.kind === 'node' && selected.has(identityKey(matrixIdentity(data, it.path))))
    if (rowIdx.length) {
      const headers = ['', ...layout.leaves.map((_, li) => view.leafLabels[li])]
      void copyToClipboard(toTsv(headers, rowIdx.map(({ i }) => [view.rowLabels[i], ...cells[i].map((c) => c.text)])))
    } else if (lastCell.current) {
      const { row, col } = lastCell.current
      const text = col < 0 ? view.rowLabels[row] : cells[row]?.[col]?.text
      if (text !== undefined) void copyToClipboard(text)
    }
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
            ctx.showContextMenu({ x: e.clientX, y: e.clientY, identity: it.kind === 'node' ? matrixIdentity(data, it.path) : undefined })
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
                padding: `${pad}px ${CELL_PAD_X}px`,
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
        totalWidth={Math.max(totalWidth, frozenWidth)}
        rowCount={layout.items.length}
        estimateRowHeight={rowH}
        measure={f.values.wordWrap || f.rowHeaders.wordWrap}
        background={f.values.backPrimary}
        header={header}
        renderRow={renderRow}
        onNearEnd={data?.hasMore ? loadMore : undefined}
        nearEndThreshold={LOAD_MORE_THRESHOLD}
        onNearRightEnd={data?.columnsCapped ? loadMoreColumns : undefined}
        nearRightThresholdPx={LOAD_MORE_COLUMNS_PX}
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

function setCorner(visualJson: any, width: number): void {
  const v = visualJson.visual
  v.objects ??= {}
  const list: any[] = (v.objects.columnWidth ??= [])
  const entry = list.find((e) => e.selector?.id === 'cornerColumn')
  const value = { expr: { Literal: { Value: `${width}D` } } }
  if (entry) entry.properties = { ...entry.properties, value }
  else list.push({ properties: { value }, selector: { id: 'cornerColumn' } })
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
