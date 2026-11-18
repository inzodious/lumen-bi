/**
 * Power BI zoom slider (Format ▸ Zoom slider, PBIR object `zoom`): a thin track along an axis
 * with a highlighted window and two round handles. Dragging a handle resizes the window,
 * dragging the window pans it, a click on the track centres the window there and a double-click
 * resets to the full range. The window is a pair of fractions [lo, hi] of the full axis.
 */
import { useRef } from 'react'

export interface ZoomSliderProps {
  orientation: 'horizontal' | 'vertical'
  /** track start (x for horizontal, y for vertical) and cross-axis position */
  x: number
  y: number
  length: number
  range: [number, number]
  /** vertical sliders run bottom (lo) → top (hi), like the value axis */
  onChange(range: [number, number]): void
  /** the user finished a gesture (drag end, track click, double-click reset): persist the window */
  onCommit?(range: [number, number]): void
  /** show the range labels at the handles (zoom.showLabels) */
  labels?: [string, string]
}

const MIN_SPAN = 0.02

export function clampWindow(lo: number, hi: number, minSpan = MIN_SPAN): [number, number] {
  let a = Math.max(0, Math.min(1, lo))
  let b = Math.max(0, Math.min(1, hi))
  if (b - a < minSpan) {
    if (a + minSpan <= 1) b = a + minSpan
    else a = b - minSpan
  }
  return [a, b]
}

export function ZoomSlider({ orientation, x, y, length, range, onChange, onCommit, labels }: ZoomSliderProps) {
  const drag = useRef<{ kind: 'lo' | 'hi' | 'pan'; start: number; range: [number, number] } | null>(null)
  // latest window during a drag (props lag one render behind)
  const last = useRef<[number, number] | null>(null)
  const change = (r: [number, number]) => {
    last.current = r
    onChange(r)
  }
  const horiz = orientation === 'horizontal'
  // fraction → px along the track
  const pos = (f: number) => (horiz ? x + f * length : y + (1 - f) * length)
  const frac = (clientPx: number, box: DOMRect) => {
    const local = horiz ? clientPx - box.left - x : clientPx - box.top - y
    return horiz ? local / length : 1 - local / length
  }
  const coord = (e: React.PointerEvent) => (horiz ? e.clientX : e.clientY)
  const svgBox = (e: React.PointerEvent) => ((e.currentTarget as SVGElement).ownerSVGElement ?? (e.currentTarget as SVGElement)).getBoundingClientRect()

  const begin = (kind: 'lo' | 'hi' | 'pan') => (e: React.PointerEvent) => {
    e.stopPropagation()
    ;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
    drag.current = { kind, start: coord(e), range }
  }
  const move = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const deltaPx = coord(e) - d.start
    const df = (horiz ? deltaPx : -deltaPx) / Math.max(1, length)
    if (d.kind === 'lo') change(clampWindow(Math.min(d.range[0] + df, d.range[1] - MIN_SPAN), d.range[1]))
    else if (d.kind === 'hi') change(clampWindow(d.range[0], Math.max(d.range[1] + df, d.range[0] + MIN_SPAN)))
    else {
      const span = d.range[1] - d.range[0]
      const lo = Math.max(0, Math.min(1 - span, d.range[0] + df))
      change([lo, lo + span])
    }
  }
  const end = () => {
    const moved = last.current
    drag.current = null
    last.current = null
    if (moved) onCommit?.(moved)
  }
  const trackClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    const box = ((e.currentTarget as SVGElement).ownerSVGElement ?? (e.currentTarget as SVGElement)).getBoundingClientRect()
    const f = frac(horiz ? e.clientX : e.clientY, box as DOMRect)
    const span = range[1] - range[0]
    const lo = Math.max(0, Math.min(1 - span, f - span / 2))
    onChange([lo, lo + span])
    onCommit?.([lo, lo + span])
  }
  void svgBox

  const a = pos(range[0])
  const b = pos(range[1])
  const R = 5
  const track = horiz ? { x, y: y - 2, width: length, height: 4 } : { x: x - 2, y, width: 4, height: length }
  const win = horiz ? { x: Math.min(a, b), y: y - 2, width: Math.abs(b - a), height: 4 } : { x: x - 2, y: Math.min(a, b), width: 4, height: Math.abs(b - a) }
  const handle = (p: number, kind: 'lo' | 'hi') => (
    <circle
      cx={horiz ? p : x}
      cy={horiz ? y : p}
      r={R}
      fill="#FFFFFF"
      stroke="#8A8886"
      strokeWidth={1}
      style={{ cursor: horiz ? 'ew-resize' : 'ns-resize' }}
      onPointerDown={begin(kind)}
      onPointerMove={move}
      onPointerUp={end}
    />
  )
  return (
    <g onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => (e.stopPropagation(), onChange([0, 1]), onCommit?.([0, 1]))}>
      <rect {...track} rx={2} fill="#E1DFDD" style={{ cursor: 'pointer' }} onClick={trackClick} />
      <rect {...win} rx={2} fill="#8A8886" style={{ cursor: 'grab' }} onPointerDown={begin('pan')} onPointerMove={move} onPointerUp={end} />
      {handle(a, 'lo')}
      {handle(b, 'hi')}
      {labels ? (
        <>
          <text x={horiz ? a : x + R + 3} y={horiz ? y - R - 3 : a} dy={horiz ? 0 : '0.35em'} textAnchor={horiz ? 'middle' : 'start'} fontSize={10} fontFamily="Segoe UI" fill="#605E5C" pointerEvents="none">
            {labels[0]}
          </text>
          <text x={horiz ? b : x + R + 3} y={horiz ? y - R - 3 : b} dy={horiz ? 0 : '0.35em'} textAnchor={horiz ? 'middle' : 'start'} fontSize={10} fontFamily="Segoe UI" fill="#605E5C" pointerEvents="none">
            {labels[1]}
          </text>
        </>
      ) : null}
    </g>
  )
}
