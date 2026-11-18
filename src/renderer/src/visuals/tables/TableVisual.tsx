/** Table visual (tableEx) renderer. */
import { useCallback, useMemo, useRef, useState, type CSSProperties } from 'react'
import { identityKey } from '@core/report/sq'
import type { ContextMenuEntry, VisualProps } from '../contract'
import { fontStyle, ptToPx } from '../common/textStyle'
import { promptDialog } from '../../app/ui'
import { CellContent, Grid, HeaderLabel, headerSeparator, ResizeHandle } from './Grid'
import { applySort, buildTableModel, nextSort, type TableColumn } from './tableModel'
import { headerAlignment, outlineBorders } from './tableFormat'
import { cellPadX, computeWidths, contentWidth, CELL_PAD_X, MIN_COLUMN_WIDTH, WRAP_TEXT, type WidthInput } from './widths'
import { resetColumnWidth, setColumnWidth as setWidth, visualObjects } from './columnWidths'
import type { CellModel } from './cellModel'
import { copyToClipboard, copyValueText, isCopyKey, toTsv } from './copy'
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

  // Layout ▸ Column width: `available` is the viewport without the vertical scrollbar (reported by the grid)
  const [viewport, setViewport] = useState<number | undefined>()
  const available = viewport !== undefined ? Math.min(width, viewport) : width
  const widthInputs = useMemo(
    (): WidthInput[] =>
      model.columns.map((c, ci) => ({
        header: c.label,
        headerFont: f.header.font,
        // images and sparklines are sized by their graphic, not by their (URL) text
        texts: c.sparkline || isImageColumn(c) || (f.values.urlIcon && isUrlColumn(c)) ? [] : model.rows.slice(0, AUTOSIZE_SAMPLE_ROWS).map((r) => r[ci].text),
        valueFont: f.values.font,
        // the total is drawn with its own (bold) font
        extraTexts: model.total?.[ci]?.text && !c.sparkline ? [{ text: model.total[ci].text, font: f.total.font }] : undefined,
        explicit: f.widthByRef.get(c.queryRef),
        minWidth: c.sparkline ? SPARKLINE_DEFAULT_WIDTH : isImageColumn(c) ? f.grid.imageWidth ?? f.grid.imageHeight : undefined,
        // the sort caret sits below the header text (HeaderLabel): no extra width
        extra: c.cf?.icon ? valuePx + 4 : 0
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model]
  )
  const widthOptions = { behavior: f.sizing.behavior, legacyManual: f.sizing.legacyManual, defaultWidth: f.sizing.defaultWidth, wrapHeader: f.header.wordWrap, available }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const widths = useMemo(() => computeWidths(widthInputs, widthOptions), [widthInputs, available])
  const colWidths = preview ? widths.map((w, i) => (i === preview.col ? preview.width : w)) : widths
  const totalWidth = colWidths.reduce((a, b) => a + b, 0)

  if (model.error) return <Message text={`Couldn't load the data for this visual. ${model.error}`} />
  if (!model.columns.length) return <Message text="Add data fields to Columns to build a table." muted />

  const pad = f.grid.rowPadding
  const rowH = Math.ceil(valuePx * 1.36) + pad * 2 + (f.grid.horizontal ? f.grid.horizontalWeight : 0)
  const wrapValues = f.values.wordWrap
  const hasImages = model.columns.some((c) => (c.dataCategory ?? '').toLowerCase() === 'imageurl')
  const selected = new Set(ctx.selection.map(identityKey))
  /** selected rows as TSV with headers (Copy ▸ Copy selection, Ctrl+C); undefined without a selection */
  const selectionText = (): string | undefined => {
    const sel = model.identities.map((id, i) => ({ id, i })).filter(({ id }) => id && selected.has(identityKey(id)))
    if (!sel.length) return undefined
    const cols = model.columns.map((c, i) => ({ c, i })).filter(({ c }) => !c.sparkline)
    return toTsv(cols.map(({ c }) => c.label), sel.map(({ i }) => cols.map(({ i: ci }) => model.rows[i][ci].text)))
  }
  const copySelection = () => {
    const text = selectionText() ?? (lastCell.current ? model.rows[lastCell.current.row]?.[lastCell.current.col]?.text : undefined)
    if (text !== undefined) void copyToClipboard(text)
  }

  // ---- column widths (custom widths are `columnWidth` entries keyed by the column's queryRef) ----
  const editable = ctx.mode === 'edit'
  const resize = (c: TableColumn, w: number) => ctx.updateVisual((j) => setWidth(visualObjects(j), c.queryRef, w))
  const autoFit = (ci: number) => resize(model.columns[ci], contentWidth(widthInputs[ci], widthOptions))
  const widthEntries = (ci: number): ContextMenuEntry[] => {
    const c = model.columns[ci]
    if (!editable) return []
    return [
      {
        label: 'Set column width',
        onClick: () =>
          void promptDialog({ title: 'Set column width', label: `Width of "${c.label}" (pixels)`, value: String(Math.round(widths[ci])), validate: validWidth }).then((v) => {
            if (v !== null) resize(c, Number(v))
          })
      },
      { label: 'Reset column width', disabled: !f.widthByRef.has(c.queryRef), onClick: () => ctx.updateVisual((j) => resetColumnWidth(visualObjects(j), c.queryRef)) }
    ]
  }
  const outline = (o: Parameters<typeof outlineBorders>[0]) => outlineBorders(o, f.grid.outlineColor, f.grid.outlineWeight)

  const cellBase = (ci: number, last: boolean): CSSProperties => ({
    position: 'relative',
    flex: `0 0 ${colWidths[ci]}px`,
    width: colWidths[ci],
    padding: `${pad}px ${cellPadX(colWidths[ci])}px`,
    display: 'flex',
    alignItems: 'flex-start',
    overflow: 'hidden',
    borderRight: f.grid.vertical && !last && colWidths[ci] > 0 ? `${f.grid.verticalWeight}px solid ${f.grid.verticalColor}` : undefined
  })

  const onHeaderClick = (c: TableColumn) => {
    ctx.updateVisual((j) => applySort(j, nextSort(j, c)))
  }

  const header = (
    <div style={{ display: 'flex', background: f.header.background ?? f.values.backPrimary, ...outline(f.header.outline), ...fontStyle(f.header.font) }}>
      {model.columns.map((c, ci) => {
        const ov = c.override?.styleHeader ? c.override : undefined
        const align = c.sparkline && !f.header.alignment ? 'center' : headerAlignment(f, c.override)
        const last = ci === model.columns.length - 1
        return (
          <div
            key={c.queryRef + ci}
            style={{
              ...cellBase(ci, last),
              ...(!f.grid.vertical && !last ? headerSeparator(f.header.font.color) : {}),
              background: ov?.backColor,
              color: ov?.fontColor,
              cursor: 'pointer',
              // Power BI top-aligns header text (a one-line header next to wrapped ones sits on the first line)
              alignItems: 'flex-start',
              justifyContent: align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start'
            }}
            data-col={c.queryRef}
            data-align={align}
            role="columnheader"
            onClick={() => onHeaderClick(c)}
            onContextMenu={(e) => {
              e.preventDefault()
              ctx.showContextMenu({ x: e.clientX, y: e.clientY, target: 'header', value: c.label, selectionText, entries: widthEntries(ci) })
            }}
            title={c.label}
          >
            <HeaderLabel
              text={c.label}
              align={align}
              sort={c.sort}
              color={ov?.fontColor ?? f.header.font.color}
              textStyle={f.header.wordWrap ? { ...WRAP_TEXT, textAlign: align } : { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
            />
            {editable ? (
              <ResizeHandle
                width={colWidths[ci]}
                label={c.label}
                onPreview={(w) => setPreview(w === undefined ? undefined : { col: ci, width: w })}
                onResize={(w) => resize(c, w)}
                onAutoFit={() => autoFit(ci)}
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
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
            const id = rowIndex >= 0 ? model.identities[rowIndex] : undefined
            ctx.showContextMenu({ x: e.clientX, y: e.clientY, identity: id?.fields.length ? id : undefined, target: isTotal ? 'total' : 'dataPoint', value: copyValueText(cell), selectionText })
          }}
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
        bodyStyle={outline(f.values.outline)}
        header={header}
        footer={footer}
        onNearEnd={model.hasMore ? loadMore : undefined}
        nearEndThreshold={LOAD_MORE_THRESHOLD}
        onViewportWidth={setViewport}
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

/** Set a column's custom width in a visual JSON (see ./columnWidths). */
export function setColumnWidth(visualJson: any, queryRef: string, width: number): void {
  setWidth(visualObjects(visualJson), queryRef, width)
}

/** Validation of the "Set column width" prompt. */
export function validWidth(v: string): string | undefined {
  const n = Number(v)
  if (v.trim() === '' || !Number.isFinite(n)) return 'Enter a width in pixels.'
  if (n < MIN_COLUMN_WIDTH || n > 2000) return `Enter a width between ${MIN_COLUMN_WIDTH} and 2000 pixels.`
  return undefined
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
