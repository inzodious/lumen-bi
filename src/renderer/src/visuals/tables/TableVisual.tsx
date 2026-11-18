/** Table visual (tableEx) renderer. */
import { useCallback, useMemo, useRef, useState, type CSSProperties } from 'react'
import { identityKey } from '@core/report/sq'
import type { VisualProps } from '../contract'
import { fontStyle, ptToPx } from '../common/textStyle'
import { CellContent, Grid, ResizeHandle, SortCaret } from './Grid'
import { applySort, buildTableModel, nextSort, type TableColumn } from './tableModel'
import { outlineBorders } from './tableFormat'
import { computeWidths, CELL_PAD_X } from './widths'
import type { CellModel } from './cellModel'
import { copyToClipboard, isCopyKey, toTsv } from './copy'
import { SPARKLINE_DEFAULT_WIDTH } from './sparklineModel'
import { LOAD_MORE_THRESHOLD, ROW_WINDOW } from './windowQuery'

/** Power BI auto-sizes columns from the first 50 rows (and headers) — Learn: "Auto-size behavior". */
export const AUTOSIZE_SAMPLE_ROWS = 50

export function TableVisual({ visual, width, height, ctx }: VisualProps) {
  const json = visual.json
  // data windowing (PBI: 500 rows at a time, next window fetched when scrolling near the end);
  // a new query shape (fields, sort, filters) starts again from the first window
  const shapeKey = JSON.stringify([json?.visual?.query, ctx.filters])
  const [winState, setWinState] = useState({ key: shapeKey, engine: ctx.engine, win: ROW_WINDOW })
  const win = winState.key === shapeKey && winState.engine === ctx.engine ? winState.win : ROW_WINDOW
  const model = useMemo(() => buildTableModel(json, ctx, win), [json, ctx.engine, ctx.filters, ctx.theme, win])
  const loadMore = useCallback(() => {
    if (model.hasMore) setWinState({ key: shapeKey, engine: ctx.engine, win: model.window + ROW_WINDOW })
  }, [model, shapeKey, ctx.engine])
  const [preview, setPreview] = useState<{ col: number; width: number } | undefined>()
  const lastCell = useRef<{ row: number; col: number } | null>(null)
  const f = model.format
  const valuePx = ptToPx(f.values.font.size)
  const headerPx = ptToPx(f.header.font.size)

  const widths = useMemo(
    () =>
      computeWidths(
        model.columns.map((c, ci) => ({
          header: c.label,
          headerFont: f.header.font,
          // images and sparklines are sized by their graphic, not by their (URL) text
          texts:
            c.sparkline || isImageColumn(c) || (f.values.urlIcon && isUrlColumn(c))
              ? []
              : [...model.rows.slice(0, AUTOSIZE_SAMPLE_ROWS).map((r) => r[ci].text), model.total?.[ci]?.text ?? ''],
          valueFont: f.values.font,
          explicit: f.widthByRef.get(c.queryRef),
          minWidth: c.sparkline ? SPARKLINE_DEFAULT_WIDTH : isImageColumn(c) ? f.grid.imageWidth ?? f.grid.imageHeight : undefined,
          extra: (c.sort ? 12 : 0) + (c.cf?.icon ? valuePx + 4 : 0)
        })),
        { autoSize: f.header.autoSize, defaultWidth: f.header.defaultWidth, wrapHeader: f.header.wordWrap, available: width, adjustment: f.header.columnAdjustment }
      ),
    [model, width]
  )
  const colWidths = preview ? widths.map((w, i) => (i === preview.col ? preview.width : w)) : widths
  const totalWidth = colWidths.reduce((a, b) => a + b, 0)

  if (model.error) return <Message text={`Couldn't load the data for this visual. ${model.error}`} />
  if (!model.columns.length) return <Message text="Add data fields to Columns to build a table." muted />

  const pad = f.grid.rowPadding
  const rowH = Math.ceil(valuePx * 1.36) + pad * 2 + (f.grid.horizontal ? f.grid.horizontalWeight : 0)
  const wrapValues = f.values.wordWrap
  const hasImages = model.columns.some((c) => (c.dataCategory ?? '').toLowerCase() === 'imageurl')
  const copySelection = () => {
    const sel = model.identities.map((id, i) => ({ id, i })).filter(({ id }) => id && selected.has(identityKey(id)))
    if (sel.length) {
      const cols = model.columns.map((c, i) => ({ c, i })).filter(({ c }) => !c.sparkline)
      void copyToClipboard(toTsv(cols.map(({ c }) => c.label), sel.map(({ i }) => cols.map(({ i: ci }) => model.rows[i][ci].text))))
    } else if (lastCell.current) {
      const cell = model.rows[lastCell.current.row]?.[lastCell.current.col]
      if (cell) void copyToClipboard(cell.text)
    }
  }
  const selected = new Set(ctx.selection.map(identityKey))
  const outline = (o: Parameters<typeof outlineBorders>[0]) => outlineBorders(o, f.grid.outlineColor, f.grid.outlineWeight)

  const cellBase = (ci: number, last: boolean): CSSProperties => ({
    position: 'relative',
    flex: `0 0 ${colWidths[ci]}px`,
    width: colWidths[ci],
    padding: `${pad}px ${CELL_PAD_X}px`,
    display: 'flex',
    alignItems: 'flex-start',
    overflow: 'hidden',
    borderRight: f.grid.vertical && !last ? `${f.grid.verticalWeight}px solid ${f.grid.verticalColor}` : undefined
  })

  const onHeaderClick = (c: TableColumn) => {
    ctx.updateVisual((j) => applySort(j, nextSort(j, c)))
  }

  const header = (
    <div style={{ display: 'flex', background: f.header.background ?? f.values.backPrimary, ...outline(f.header.outline), ...fontStyle(f.header.font) }}>
      {model.columns.map((c, ci) => {
        const ov = c.override?.styleHeader ? c.override : undefined
        const align = f.header.alignment ?? c.align
        return (
          <div
            key={c.queryRef + ci}
            style={{ ...cellBase(ci, ci === model.columns.length - 1), background: ov?.backColor, color: ov?.fontColor, cursor: 'pointer', alignItems: 'flex-end', justifyContent: align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start' }}
            onClick={() => onHeaderClick(c)}
            title={c.label}
          >
            {c.sort && align === 'right' ? <SortCaret dir={c.sort} color={f.header.font.color} /> : null}
            <span style={f.header.wordWrap ? { whiteSpace: 'normal', overflowWrap: 'anywhere', textAlign: align } : { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.label}</span>
            {c.sort && align !== 'right' ? <SortCaret dir={c.sort} color={f.header.font.color} /> : null}
            {ctx.mode === 'edit' ? (
              <ResizeHandle
                width={colWidths[ci]}
                onPreview={(w) => setPreview(w === undefined ? undefined : { col: ci, width: w })}
                onResize={(w) => ctx.updateVisual((j) => setColumnWidth(j, c.queryRef, w))}
              />
            ) : null}
          </div>
        )
      })}
    </div>
  )

  const renderCells = (cells: CellModel[], rowStyle: { color: string; fontStyle: CSSProperties }, isTotal: boolean, rowIndex = -1) =>
    cells.map((cell, ci) => {
      const c = model.columns[ci]
      return (
        <div
          key={ci}
          style={{ ...cellBase(ci, ci === cells.length - 1), background: cell.background, color: cell.color ?? rowStyle.color, alignItems: cell.spark ? 'center' : 'flex-start' }}
          onMouseDown={() => (lastCell.current = rowIndex >= 0 ? { row: rowIndex, col: ci } : null)}
          onMouseMove={(e) =>
            !isTotal && cell.text
              ? ctx.showTooltip({ x: e.clientX, y: e.clientY, items: [{ label: c.label, value: cell.text }] })
              : undefined
          }
          onMouseLeave={() => ctx.showTooltip(null)}
        >
          <CellContent
            cell={cell}
            align={c.align}
            wrap={wrapValues && !isTotal}
            fontPx={valuePx}
            urlIcon={f.values.urlIcon}
            imageHeight={f.grid.imageHeight}
            imageWidth={f.grid.imageWidth}
            contentWidth={colWidths[ci] - 2 * CELL_PAD_X}
            onOpenUrl={(u) => ctx.actions.openUrl(u)}
          />
        </div>
      )
    })

  const footer = model.total ? (
    <div style={{ display: 'flex', background: f.total.background ?? f.values.backPrimary, ...outline(f.total.outline), ...fontStyle(f.total.font) }}>
      {renderCells(model.total, { color: f.total.font.color, fontStyle: {} }, true)}
    </div>
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
        totalWidth={totalWidth}
        rowCount={model.rows.length}
        estimateRowHeight={hasImages ? Math.max(rowH, f.grid.imageHeight + pad * 2) : rowH}
        measure={wrapValues || hasImages}
        background={f.values.backPrimary}
        header={header}
        footer={footer}
        onNearEnd={model.hasMore ? loadMore : undefined}
        nearEndThreshold={LOAD_MORE_THRESHOLD}
        renderRow={(i, style, ref) => {
          const odd = i % 2 === 1
          const id = model.identities[i]
          const isSel = selected.size > 0 && id && selected.has(identityKey(id))
          const bg = odd ? f.values.backSecondary : f.values.backPrimary
          const color = odd ? f.values.fontColorSecondary : f.values.font.color
          return (
            <div
              key={i}
              ref={ref}
              style={{
                ...style,
                display: 'flex',
                background: bg,
                ...fontStyle({ ...f.values.font, color }),
                borderBottom: f.grid.horizontal ? `${f.grid.horizontalWeight}px solid ${f.grid.horizontalColor}` : undefined,
                boxShadow: isSel ? 'inset 0 0 0 9999px rgba(17,141,255,0.10)' : undefined,
                minHeight: rowH
              }}
              onClick={(e) => {
                if (!id || !id.fields.length) return
                const k = identityKey(id)
                const multi = e.ctrlKey || e.metaKey
                if (selected.has(k) && (multi || selected.size === 1)) ctx.select(ctx.selection.filter((s) => identityKey(s) !== k))
                else ctx.select(multi ? [...ctx.selection, id] : [id], { multi })
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                ctx.showContextMenu({ x: e.clientX, y: e.clientY, identity: id })
              }}
            >
              {renderCells(model.rows[i], { color, fontStyle: {} }, false, i)}
            </div>
          )
        }}
      />
      {model.truncated ? <TruncatedBadge /> : null}
    </div>
  )
}

/** URL columns shown as link icons (values.urlIcon) are sized by the icon, not the URL text. */
function isUrlColumn(c: TableColumn): boolean {
  return (c.dataCategory ?? '').toLowerCase() === 'weburl'
}

function isImageColumn(c: TableColumn): boolean {
  return (c.dataCategory ?? '').toLowerCase() === 'imageurl'
}

export function setColumnWidth(visualJson: any, queryRef: string, width: number): void {
  const v = visualJson.visual
  v.objects ??= {}
  const list: any[] = (v.objects.columnWidth ??= [])
  const entry = list.find((e) => e.selector?.metadata === queryRef)
  const value = { expr: { Literal: { Value: `${width}D` } } }
  if (entry) entry.properties = { ...entry.properties, value }
  else list.push({ properties: { value }, selector: { metadata: queryRef } })
}

export function Message({ text, muted }: { text: string; muted?: boolean }) {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 12, color: muted ? '#605E5C' : '#A4262C', fontSize: 12 }}>
      {text}
    </div>
  )
}

function TruncatedBadge() {
  return (
    <div
      title="Showing a representative sample of the data (the row limit was reached)."
      style={{ position: 'absolute', right: 10, top: 2, fontSize: 11, color: '#605E5C', background: '#FFF4CE', borderRadius: 2, padding: '0 4px', pointerEvents: 'auto' }}
    >
      !
    </div>
  )
}
