/**
 * Virtualized grid shell used by the table and matrix visuals: a scroll container with a sticky
 * header block and absolutely positioned (virtualized, dynamically measured) body rows, and a
 * footer below it (totals follow the last row, and stay pinned to the bottom of the visual once
 * the rows scroll, like in Power BI). Frozen left columns are implemented by the caller with
 * `position: sticky; left: …` cells.
 */
import { useEffect, useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { CellModel } from './cellModel'
import { CFIcon } from './cfIcons'
import { sparklineGeometry, type MarkerShape, type SparkPoint, type SparklineFormat } from './sparklineModel'
import { MIN_COLUMN_WIDTH, WRAP_TEXT } from './widths'
import { rgba } from '../common/color'

export interface GridProps {
  width: number
  height: number
  totalWidth: number
  rowCount: number
  estimateRowHeight: number
  /** fixed row heights (no wrapping) skip DOM measurement */
  measure: boolean
  header: ReactNode
  footer?: ReactNode
  /** extra style of the body (values) region, e.g. the Values border */
  bodyStyle?: CSSProperties
  renderRow(index: number, style: CSSProperties, measureRef: (el: HTMLElement | null) => void): ReactNode
  background?: string
  /**
   * Data windowing: called when the rendered rows come within `nearEndThreshold` rows of the end
   * (the caller loads the next window). Not called again until `rowCount` changes.
   */
  onNearEnd?(): void
  nearEndThreshold?: number
  /**
   * Column windowing: called when horizontal scrolling comes within `nearRightThresholdPx` of the
   * right end of the content (the caller loads the next column window). Not called again until
   * `totalWidth` changes.
   */
  onNearRightEnd?(): void
  nearRightThresholdPx?: number
  /**
   * Width of the scroll viewport without the vertical scrollbar, reported whenever it changes — the space
   * "Grow to fit" has to fill (a scrollbar appearing must not push the last column out of view).
   */
  onViewportWidth?(width: number): void
}

export function Grid(props: GridProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const virtualizer = useVirtualizer({
    count: props.rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => props.estimateRowHeight,
    overscan: 12,
    // jsdom / capture-less environments: render a sensible first window
    initialRect: { width: props.width, height: props.height }
  })
  const items = virtualizer.getVirtualItems()
  const lastIndex = items.length ? items[items.length - 1].index : -1
  const requested = useRef(-1)
  const { onNearEnd, rowCount } = props
  const threshold = props.nearEndThreshold ?? 60
  useEffect(() => {
    if (!onNearEnd || requested.current === rowCount) return
    if (lastIndex >= rowCount - 1 - threshold) {
      requested.current = rowCount
      onNearEnd()
    }
  }, [onNearEnd, lastIndex, rowCount, threshold])
  const requestedRight = useRef(-1)
  const { onNearRightEnd, totalWidth } = props
  const rightPx = props.nearRightThresholdPx ?? 400
  const lastViewport = useRef(0)
  const { onViewportWidth } = props
  const footRef = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    if (footRef.current && scrollRef.current) footRef.current.scrollLeft = scrollRef.current.scrollLeft
    const w = scrollRef.current?.clientWidth ?? 0
    // 0 = not laid out (hidden page, jsdom)
    if (!onViewportWidth || w <= 0 || w === lastViewport.current) return
    lastViewport.current = w
    onViewportWidth(w)
  })
  const checkRight = () => {
    const el = scrollRef.current
    if (!el || !onNearRightEnd || requestedRight.current === totalWidth) return
    if (el.scrollLeft + el.clientWidth >= el.scrollWidth - rightPx && el.scrollLeft > 0) {
      requestedRight.current = totalWidth
      onNearRightEnd()
    }
  }
  const onScroll = () => {
    // the footer follows the body horizontally
    if (footRef.current && scrollRef.current) footRef.current.scrollLeft = scrollRef.current.scrollLeft
    if (onNearRightEnd) checkRight()
  }
  return (
    <div style={{ width: props.width, height: props.height, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: props.background }}>
      <style>{SCROLLBAR_CSS}</style>
      {/* header + body scroll; the scroller only grows to its content, so the footer follows the last row and is
          pinned to the bottom once the rows overflow (laid out outside the scroller: a sticky-bottom footer is painted
          off its layout position at fractional canvas zooms) */}
      <div ref={scrollRef} onScroll={onScroll} className="wbi-table-scroll" style={{ width: props.width, flex: '0 1 auto', minHeight: 0, overflow: 'auto', position: 'relative' }}>
        <div style={{ width: props.totalWidth, minWidth: '100%', position: 'relative' }}>
          <div style={{ position: 'sticky', top: 0, zIndex: 3, width: props.totalWidth }}>{props.header}</div>
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: props.totalWidth, ...props.bodyStyle }}>
            {items.map((it) =>
              props.renderRow(
                it.index,
                { position: 'absolute', top: 0, left: 0, width: props.totalWidth, transform: `translateY(${it.start}px)` },
                (el) => {
                  if (el && props.measure) {
                    el.dataset.index = String(it.index)
                    virtualizer.measureElement(el)
                  }
                }
              )
            )}
          </div>
        </div>
      </div>
      {props.footer ? (
        <div ref={footRef} className="wbi-table-footer" style={{ width: props.width, flex: '0 0 auto', overflow: 'hidden', position: 'relative' }}>
          <div style={{ width: props.totalWidth, minWidth: '100%', position: 'relative', zIndex: 3 }}>{props.footer}</div>
        </div>
      ) : null}
    </div>
  )
}

const SCROLLBAR_CSS = `
.wbi-table-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
.wbi-table-scroll::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.22); border-radius: 4px; }
.wbi-table-scroll::-webkit-scrollbar-thumb:hover { background: rgba(0,0,0,0.38); }
.wbi-table-scroll:not(:hover)::-webkit-scrollbar-thumb { background: transparent; }
.wbi-table-scroll::-webkit-scrollbar-track, .wbi-table-scroll::-webkit-scrollbar-corner { background: transparent; }
.wbi-table-resize { position: absolute; top: 0; right: 0; width: 7px; height: 100%; cursor: col-resize; z-index: 2; touch-action: none; }
.wbi-table-resize:hover, .wbi-table-resize.is-dragging { background: rgba(0,0,0,0.12); }
.wbi-table-link { color: inherit; text-decoration: underline; cursor: pointer; }
`

/** Content of one data cell: text with optional CF icon, data bar, link or image. */
export function CellContent({
  cell,
  align,
  wrap,
  fontPx,
  urlIcon,
  imageHeight,
  imageWidth,
  contentWidth,
  onOpenUrl
}: {
  cell: CellModel
  align: 'left' | 'center' | 'right'
  wrap: boolean
  fontPx: number
  urlIcon?: boolean
  imageHeight?: number
  /** grid.imageWidth (undefined keeps the aspect ratio) */
  imageWidth?: number
  /** inner width of the cell in px (sparklines) */
  contentWidth?: number
  onOpenUrl?(url: string): void
}) {
  if (cell.spark) {
    const h = Math.max(12, Math.round(fontPx * 1.36))
    return <Sparkline points={cell.spark.points} format={cell.spark.format} width={Math.max(20, contentWidth ?? 100)} height={h} />
  }
  const justify = align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start'
  const textStyle: CSSProperties = wrap ? WRAP_TEXT : { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }
  let text: ReactNode = cell.hideText ? null : cell.text
  if (cell.image) {
    text = (
      <img
        src={cell.image}
        alt=""
        style={{ height: imageHeight ?? 75, width: imageWidth, maxWidth: '100%', objectFit: 'contain', display: 'block' }}
        draggable={false}
        onError={(e) => ((e.target as HTMLImageElement).style.visibility = 'hidden')}
      />
    )
  } else if (cell.url && !cell.hideText) {
    const open = (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      onOpenUrl?.(cell.url!)
    }
    text = urlIcon ? (
      <span title={cell.url} onClick={open} style={{ cursor: 'pointer', display: 'inline-flex' }}>
        <LinkIcon size={fontPx} />
      </span>
    ) : (
      <a className="wbi-table-link" href={cell.url} onClick={open} title={cell.url}>
        {cell.text}
      </a>
    )
  }
  const icon = cell.icon ? <CFIcon name={cell.icon.name} size={Math.round(fontPx)} /> : null
  return (
    <>
      {cell.bar ? (
        <div style={{ position: 'absolute', inset: '2px 0', pointerEvents: 'none' }}>
          <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${cell.bar.start * 100}%`, width: `${cell.bar.width * 100}%`, background: cell.bar.color }} />
          {cell.bar.axis !== undefined ? <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${cell.bar.axis * 100}%`, width: 1, background: cell.bar.axisColor }} /> : null}
        </div>
      ) : null}
      <div
        style={{
          position: 'relative',
          display: 'flex',
          alignItems: cell.icon?.verticalAlignment === 'middle' ? 'center' : cell.icon?.verticalAlignment === 'bottom' ? 'flex-end' : 'flex-start',
          justifyContent: justify,
          gap: 4,
          minWidth: 0,
          width: '100%'
        }}
      >
        {icon && cell.icon!.layout !== 'after' ? icon : null}
        {cell.icon?.layout === 'only' ? null : <span style={{ ...textStyle, minWidth: 0, textAlign: align }}>{text}</span>}
        {icon && cell.icon!.layout === 'after' ? icon : null}
      </div>
    </>
  )
}

/** PBI sparkline (line or column) for one cell. */
export function Sparkline({ points, format, width, height }: { points: SparkPoint[]; format: SparklineFormat; width: number; height: number }) {
  const g = sparklineGeometry(points, format, width, height)
  if (g.empty) return <svg width={width} height={height} aria-hidden />
  return (
    <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }} aria-label="Sparkline">
      {g.kind === 'line' ? (
        <path d={g.path} fill="none" stroke={format.color} strokeWidth={format.strokeWidth} strokeLinejoin="round" strokeLinecap="round" />
      ) : (
        g.bars!.map((b, i) => <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} fill={format.color} />)
      )}
      {g.markers.map((m, i) => (
        <MarkerGlyph key={i} x={m.x} y={m.y} size={format.markerSize} shape={format.markerShape} color={format.markerColor} />
      ))}
    </svg>
  )
}

function MarkerGlyph({ x, y, size, shape, color }: { x: number; y: number; size: number; shape: MarkerShape; color: string }) {
  const r = size
  switch (shape) {
    case 'square':
      return <rect x={x - r} y={y - r} width={2 * r} height={2 * r} fill={color} />
    case 'diamond':
      return <path d={`M${x} ${y - r}L${x + r} ${y}L${x} ${y + r}L${x - r} ${y}Z`} fill={color} />
    case 'triangle':
      return <path d={`M${x} ${y - r}L${x + r} ${y + r}L${x - r} ${y + r}Z`} fill={color} />
    case 'x':
      return <path d={`M${x - r} ${y - r}L${x + r} ${y + r}M${x + r} ${y - r}L${x - r} ${y + r}`} stroke={color} strokeWidth={1.2} />
    case 'plus':
      return <path d={`M${x - r} ${y}L${x + r} ${y}M${x} ${y - r}L${x} ${y + r}`} stroke={color} strokeWidth={1.2} />
    case 'shortDash':
      return <path d={`M${x - r} ${y}L${x + r} ${y}`} stroke={color} strokeWidth={1.5} />
    case 'longDash':
      return <path d={`M${x - 2 * r} ${y}L${x + 2 * r} ${y}`} stroke={color} strokeWidth={1.5} />
    default:
      return <circle cx={x} cy={y} r={r} fill={color} />
  }
}

export function LinkIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="#118DFF" strokeWidth="1.3">
      <path d="M6.5 9.5 L9.5 6.5" strokeLinecap="round" />
      <path d="M7.5 4.5 L9 3 A2.8 2.8 0 0 1 13 7 L11.5 8.5" strokeLinecap="round" />
      <path d="M8.5 11.5 L7 13 A2.8 2.8 0 0 1 3 9 L4.5 7.5" strokeLinecap="round" />
    </svg>
  )
}

/** Height the sort caret adds below a header's text (see HeaderLabel). */
export const SORT_CARET_H = 7

/**
 * A column header's text with the sort caret on its own line below it, on the header's alignment side (Power BI
 * renders: the chevron sits under the start of a left-aligned header, so a sorted single-line header is taller).
 */
export function HeaderLabel({
  text,
  align,
  textStyle,
  sort,
  color
}: {
  text: ReactNode
  align: 'left' | 'center' | 'right'
  textStyle: CSSProperties
  sort?: 'asc' | 'desc'
  color: string
}) {
  const items = align === 'right' ? 'flex-end' : align === 'center' ? 'center' : 'flex-start'
  return (
    <span style={{ display: 'flex', flexDirection: 'column', alignItems: items, minWidth: 0, maxWidth: '100%' }}>
      <span style={{ ...textStyle, maxWidth: '100%' }}>{text}</span>
      {sort ? (
        <span data-sort={sort} style={{ display: 'flex', height: SORT_CARET_H, alignItems: 'flex-end' }}>
          <SortCaret dir={sort} color={color} />
        </span>
      ) : null}
    </span>
  )
}

/**
 * Thin separator between column-header cells: Power BI renders a faint vertical line between header cells even with
 * vertical gridlines off (approximation: the header text color at 30% over the header background, 1px, measured on a
 * Power BI screenshot; not documented).
 */
export function headerSeparator(color: string): CSSProperties {
  return { boxShadow: `inset -1px 0 0 ${rgba(color, 0.3)}` }
}

/** Sort direction caret shown in a sorted column header (PBI shows a small chevron). */
export function SortCaret({ dir, color }: { dir: 'asc' | 'desc'; color: string }) {
  return (
    <svg width="8" height="6" viewBox="0 0 8 6" style={{ flex: '0 0 auto', margin: '0 2px', display: 'block' }}>
      <path d={dir === 'asc' ? 'M0.5 5 L4 1.2 L7.5 5' : 'M0.5 1 L4 4.8 L7.5 1'} fill="none" stroke={color} strokeWidth="1.1" />
    </svg>
  )
}

/**
 * Drag handle on a header cell's right edge (Power BI: hover the edge until the resize arrows appear, then drag;
 * double-click fits the column to its content). `onPreview` follows the pointer, `onResize` commits on release.
 * Deltas are divided by the canvas zoom so the edge stays under the pointer at any page scale.
 */
export function ResizeHandle({ width, onResize, onPreview, onAutoFit, label }: { width: number; onResize(w: number): void; onPreview?(w: number | undefined): void; onAutoFit?(): void; label?: string }) {
  return (
    <div
      className="wbi-table-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label={label ? `Resize ${label}` : 'Resize column'}
      title="Drag to resize · double-click to fit"
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      onDoubleClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onAutoFit?.()
      }}
      // the canvas starts moving the visual on pointerdown: keep the drag for the column
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        e.stopPropagation()
        const el = e.currentTarget
        const zoom = el.offsetWidth > 0 ? el.getBoundingClientRect().width / el.offsetWidth || 1 : 1
        const x0 = e.clientX
        let w = width
        el.classList.add('is-dragging')
        const move = (ev: PointerEvent) => {
          w = Math.max(MIN_COLUMN_WIDTH, Math.round(width + (ev.clientX - x0) / zoom))
          onPreview?.(w)
        }
        const up = () => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
          window.removeEventListener('pointercancel', up)
          el.classList.remove('is-dragging')
          onPreview?.(undefined)
          if (w !== width) onResize(w)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
        window.addEventListener('pointercancel', up)
      }}
      onMouseDown={(e) => e.stopPropagation()}
    />
  )
}
