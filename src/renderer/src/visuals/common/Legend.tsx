/**
 * Power BI–style legend: title + circle markers (or line/marker swatches for line series),
 * positions Top/Bottom/Left/Right (+Center variants), paging arrows when items overflow.
 */
import { useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { ellipsize, fontAttrs, lineHeight, measureText, type FontSpec } from './text'
import type { FormatReader } from './fmtProps'
import { PBI } from './fmtProps'
import { ptToPx } from './text'

export type LegendPosition = 'Top' | 'Bottom' | 'Left' | 'Right' | 'TopCenter' | 'BottomCenter' | 'LeftCenter' | 'RightCenter'

export interface LegendItem {
  key: string
  label: string
  color: string
  /** swatch style */
  /** circle (PBI default), line = line + marker, lineOnly = line swatch, square */
  shape?: 'circle' | 'line' | 'lineOnly' | 'square'
  dashed?: string
  dimmed?: boolean
}

export interface LegendStyle {
  show: boolean
  position: LegendPosition
  showTitle: boolean
  title: string
  font: FontSpec
  color: string
  titleFont: FontSpec
}

export function readLegendStyle(fmt: FormatReader, defaults: { show: boolean; position?: LegendPosition; title: string }): LegendStyle {
  const show = fmt.bool('legend', 'show', defaults.show)
  const position = normalizePosition(fmt.str('legend', 'position', defaults.position ?? 'Top'))
  const t = fmt.text('legend', { color: 'labelColor' }, { size: PBI.legendFontPt, color: PBI.labelColor })
  const titleText = fmt.str('legend', 'titleText', defaults.title)
  return {
    show,
    position,
    showTitle: fmt.bool('legend', 'showTitle', true) && !!titleText,
    title: titleText,
    font: t.font,
    color: t.color,
    titleFont: { ...t.font, weight: 600, size: t.font.size }
  }
}

export function normalizePosition(p: string): LegendPosition {
  const map: Record<string, LegendPosition> = {
    top: 'Top',
    bottom: 'Bottom',
    left: 'Left',
    right: 'Right',
    topcenter: 'TopCenter',
    bottomcenter: 'BottomCenter',
    leftcenter: 'LeftCenter',
    rightcenter: 'RightCenter'
  }
  return map[p.replace(/\s+/g, '').toLowerCase()] ?? 'Top'
}

export const isVertical = (p: LegendPosition) => p.startsWith('Left') || p.startsWith('Right')

const MARKER = 8
// Spacing inferred from Power BI renders of Top legends in two different reports (markers close to their text, items
// packed tightly): ≈ 3 px from the marker to its text and ≈ 7 px from the end of a text to the next marker. The
// pixel values come from photographs of the screen, so they are approximate; not documented.
export const MARKER_GAP = 3
export const ITEM_GAP = 7
const ARROW = 14

export interface LegendLayout {
  /** space taken from the visual (height for top/bottom, width for left/right) */
  size: number
  position: LegendPosition
}

/** Space the legend needs. Vertical legends take at most 30% of the width. */
export function measureLegend(style: LegendStyle, items: LegendItem[], width: number, height: number): LegendLayout {
  if (!style.show || !items.length) return { size: 0, position: style.position }
  const lh = lineHeight(style.font)
  if (isVertical(style.position)) {
    const widest = Math.max(...items.map((i) => MARKER + MARKER_GAP + measureText(i.label, style.font)), style.showTitle ? measureText(style.title, style.titleFont) : 0)
    return { size: Math.min(Math.ceil(widest) + 10, Math.max(40, width * 0.3)), position: style.position }
  }
  void height
  return { size: Math.max(lh, MARKER) + 8, position: style.position }
}

interface LegendProps {
  style: LegendStyle
  items: LegendItem[]
  x: number
  y: number
  width: number
  height: number
  onItemClick?: (key: string, e: ReactMouseEvent) => void
}

function Swatch({ item, x, cy }: { item: LegendItem; x: number; cy: number }) {
  if (item.shape === 'line')
    return (
      <g>
        <line x1={x} x2={x + MARKER + 4} y1={cy} y2={cy} stroke={item.color} strokeWidth={2} strokeDasharray={item.dashed} />
        <circle cx={x + (MARKER + 4) / 2} cy={cy} r={3} fill={item.color} />
      </g>
    )
  if (item.shape === 'lineOnly') return <line x1={x} x2={x + MARKER + 4} y1={cy} y2={cy} stroke={item.color} strokeWidth={2} strokeDasharray={item.dashed} />
  if (item.shape === 'square') return <rect x={x} y={cy - MARKER / 2} width={MARKER} height={MARKER} fill={item.color} />
  return <circle cx={x + MARKER / 2} cy={cy} r={MARKER / 2} fill={item.color} />
}

/** Renders inside an <svg>. */
export function Legend({ style, items, x, y, width, height, onItemClick }: LegendProps) {
  const [page, setPage] = useState(0)
  if (!style.show || !items.length) return null
  const lh = lineHeight(style.font)
  const fa = fontAttrs(style.font)
  const vertical = isVertical(style.position)
  const swatchW = (i: LegendItem) => (i.shape === 'line' || i.shape === 'lineOnly' ? MARKER + 4 : MARKER)

  if (!vertical) {
    const cy = y + height / 2
    const titleW = style.showTitle ? measureText(style.title, style.titleFont) + 8 : 0
    const widths = items.map((i) => swatchW(i) + MARKER_GAP + Math.min(measureText(i.label, style.font), 160) + ITEM_GAP)
    const total = titleW + widths.reduce((a, b) => a + b, 0) - ITEM_GAP
    const overflow = total > width
    // paging: split into pages that fit
    const avail = width - titleW - (overflow ? ARROW * 2 + 6 : 0)
    const pages: number[][] = [[]]
    let acc = 0
    widths.forEach((w, i) => {
      if (acc + w - ITEM_GAP > avail && pages[pages.length - 1].length) {
        pages.push([])
        acc = 0
      }
      pages[pages.length - 1].push(i)
      acc += w
    })
    const pi = Math.min(page, pages.length - 1)
    const shown = pages[pi]
    const shownW = shown.reduce((a, i) => a + widths[i], 0) - ITEM_GAP + titleW + (overflow ? ARROW * 2 + 6 : 0)
    let cx = style.position.endsWith('Center') ? x + Math.max(0, (width - shownW) / 2) : x
    const out: ReactNode[] = []
    if (style.showTitle) {
      out.push(
        <text key="title" x={cx} y={cy} dy="0.35em" {...fontAttrs(style.titleFont)} fill={style.color}>
          {style.title}
        </text>
      )
      cx += titleW
    }
    if (overflow) {
      out.push(<Arrow key="prev" dir="left" x={cx} cy={cy} enabled={pi > 0} onClick={() => setPage(Math.max(0, pi - 1))} />)
      cx += ARROW + 3
    }
    for (const i of shown) {
      const it = items[i]
      const label = ellipsize(it.label, 160, style.font)
      const sx = cx
      out.push(
        <g key={it.key} opacity={it.dimmed ? 0.4 : 1} style={{ cursor: onItemClick ? 'pointer' : undefined }} onClick={(e) => onItemClick?.(it.key, e)}>
          <title>{it.label}</title>
          <rect x={sx - 2} y={cy - lh / 2} width={widths[i] - ITEM_GAP + 4} height={lh} fill="transparent" />
          <Swatch item={it} x={sx} cy={cy} />
          <text x={sx + swatchW(it) + MARKER_GAP} y={cy} dy="0.35em" {...fa} fill={style.color}>
            {label}
          </text>
        </g>
      )
      cx += widths[i]
    }
    if (overflow) out.push(<Arrow key="next" dir="right" x={cx - ITEM_GAP + 6} cy={cy} enabled={pi < pages.length - 1} onClick={() => setPage(Math.min(pages.length - 1, pi + 1))} />)
    return <g className="wbi-legend">{out}</g>
  }

  // vertical
  const rowH = Math.max(lh, MARKER) + 4
  const titleH = style.showTitle ? lineHeight(style.titleFont) + 4 : 0
  const capacity = Math.max(1, Math.floor((height - titleH) / rowH))
  const overflow = items.length > capacity
  const per = overflow ? Math.max(1, Math.floor((height - titleH - ARROW * 2 - 4) / rowH)) : capacity
  const pages = Math.ceil(items.length / per)
  const pi = Math.min(page, pages - 1)
  const shown = items.slice(pi * per, pi * per + per)
  const blockH = titleH + shown.length * rowH + (overflow ? ARROW * 2 + 4 : 0)
  let cy = style.position.endsWith('Center') ? y + Math.max(0, (height - blockH) / 2) : y
  const out: ReactNode[] = []
  if (style.showTitle) {
    out.push(
      <text key="title" x={x + 4} y={cy + titleH / 2} dy="0.35em" {...fontAttrs(style.titleFont)} fill={style.color}>
        {ellipsize(style.title, width - 4, style.titleFont)}
      </text>
    )
    cy += titleH
  }
  if (overflow) {
    out.push(<Arrow key="up" dir="up" x={x + 4} cy={cy + ARROW / 2} enabled={pi > 0} onClick={() => setPage(Math.max(0, pi - 1))} />)
    cy += ARROW + 2
  }
  for (const it of shown) {
    const ry = cy + rowH / 2
    out.push(
      <g key={it.key} opacity={it.dimmed ? 0.4 : 1} style={{ cursor: onItemClick ? 'pointer' : undefined }} onClick={(e) => onItemClick?.(it.key, e)}>
        <title>{it.label}</title>
        <rect x={x} y={cy} width={width} height={rowH} fill="transparent" />
        <Swatch item={it} x={x + 4} cy={ry} />
        <text x={x + 4 + swatchW(it) + MARKER_GAP} y={ry} dy="0.35em" {...fa} fill={style.color}>
          {ellipsize(it.label, width - swatchW(it) - MARKER_GAP - 6, style.font)}
        </text>
      </g>
    )
    cy += rowH
  }
  if (overflow) out.push(<Arrow key="down" dir="down" x={x + 4} cy={cy + ARROW / 2 + 2} enabled={pi < pages - 1} onClick={() => setPage(Math.min(pages - 1, pi + 1))} />)
  return <g className="wbi-legend">{out}</g>
}

function Arrow({ dir, x, cy, enabled, onClick }: { dir: 'left' | 'right' | 'up' | 'down'; x: number; cy: number; enabled: boolean; onClick(): void }) {
  const s = 4
  const cx = x + ARROW / 2
  const pts =
    dir === 'left'
      ? `${cx + s / 2},${cy - s} ${cx - s / 2},${cy} ${cx + s / 2},${cy + s}`
      : dir === 'right'
        ? `${cx - s / 2},${cy - s} ${cx + s / 2},${cy} ${cx - s / 2},${cy + s}`
        : dir === 'up'
          ? `${cx - s},${cy + s / 2} ${cx},${cy - s / 2} ${cx + s},${cy + s / 2}`
          : `${cx - s},${cy - s / 2} ${cx},${cy + s / 2} ${cx + s},${cy - s / 2}`
  return (
    <g
      style={{ cursor: enabled ? 'pointer' : 'default' }}
      onClick={(e) => {
        e.stopPropagation()
        if (enabled) onClick()
      }}
    >
      <rect x={x} y={cy - ARROW / 2} width={ARROW} height={ARROW} fill="transparent" />
      <polygon points={pts} fill={enabled ? '#605E5C' : '#C8C6C4'} />
    </g>
  )
}

/** Default legend font in px (for code that needs it before reading the visual). */
export const LEGEND_FONT_PX = ptToPx(PBI.legendFontPt)
