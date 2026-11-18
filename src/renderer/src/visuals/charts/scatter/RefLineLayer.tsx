/** SVG rendering of analytics reference lines (see ./referenceLines.ts). */
import type { ReactNode } from 'react'
import { fontAttrs, lineHeight } from '../../common/text'
import type { RefLine } from './referenceLines'

export interface PlotRect {
  x: number
  y: number
  w: number
  h: number
}

export interface AxisMap {
  /** data → px (absolute) */
  toPx(v: number): number
  domain: [number, number]
}

/** Reference lines (and their shaded regions / labels) for one layer (`front` or behind the data). */
export function refLineNodes(lines: RefLine[], plot: PlotRect, xAxis: AxisMap | undefined, yAxis: AxisMap, layer: 'front' | 'back'): ReactNode[] {
  const nodes: ReactNode[] = []
  const clampX = (v: number) => Math.max(plot.x, Math.min(plot.x + plot.w, v))
  const clampY = (v: number) => Math.max(plot.y, Math.min(plot.y + plot.h, v))
  for (const l of lines) {
    if ((layer === 'front') !== l.front) continue
    const ax = l.axis === 'x' ? xAxis : yAxis
    if (!ax) continue
    const [d0, d1] = [Math.min(...ax.domain), Math.max(...ax.domain)]
    if (l.value < d0 - 1e-9 * Math.abs(d1 - d0) || l.value > d1 + 1e-9 * Math.abs(d1 - d0)) continue
    const p = ax.toPx(l.value)
    if (l.shade) {
      // "before" = toward lower values, "after" = toward higher values (inverted axes handled by the mapping)
      const edge = ax.toPx(l.shade.region === 'before' ? d0 : d1)
      if (l.axis === 'y') {
        const a = clampY(Math.min(p, edge))
        const b = clampY(Math.max(p, edge))
        nodes.push(<rect key={`${l.key}|shade`} x={plot.x} y={a} width={plot.w} height={b - a} fill={l.shade.color} opacity={l.shade.opacity} pointerEvents="none" />)
      } else {
        const a = clampX(Math.min(p, edge))
        const b = clampX(Math.max(p, edge))
        nodes.push(<rect key={`${l.key}|shade`} x={a} y={plot.y} width={b - a} height={plot.h} fill={l.shade.color} opacity={l.shade.opacity} pointerEvents="none" />)
      }
    }
    const crisp = Math.round(p) + 0.5
    if (l.axis === 'y')
      nodes.push(<line key={l.key} x1={plot.x} x2={plot.x + plot.w} y1={crisp} y2={crisp} stroke={l.color} strokeOpacity={l.opacity} strokeWidth={l.width} strokeDasharray={l.dash} strokeLinecap={l.dash === '1.5 3' ? 'round' : undefined} pointerEvents="none" />)
    else nodes.push(<line key={l.key} x1={crisp} x2={crisp} y1={plot.y} y2={plot.y + plot.h} stroke={l.color} strokeOpacity={l.opacity} strokeWidth={l.width} strokeDasharray={l.dash} strokeLinecap={l.dash === '1.5 3' ? 'round' : undefined} pointerEvents="none" />)
    if (l.label) {
      const lh = lineHeight(l.label.font)
      const fa = fontAttrs(l.label.font)
      if (l.axis === 'y') {
        const right = l.label.horizontal === 'right'
        const y = l.label.vertical === 'under' ? p + 3 + lh / 2 : p - 3 - lh / 2
        nodes.push(
          <text key={`${l.key}|label`} x={right ? plot.x + plot.w - 4 : plot.x + 4} y={y} dy="0.35em" textAnchor={right ? 'end' : 'start'} {...fa} fill={l.label.color} pointerEvents="none">
            {l.label.text}
          </text>
        )
      } else {
        const right = l.label.horizontal === 'right'
        const y = l.label.vertical === 'under' ? plot.y + plot.h - 4 - lh / 2 : plot.y + 4 + lh / 2
        nodes.push(
          <text key={`${l.key}|label`} x={right ? p + 4 : p - 4} y={y} dy="0.35em" textAnchor={right ? 'start' : 'end'} {...fa} fill={l.label.color} pointerEvents="none">
            {l.label.text}
          </text>
        )
      }
    }
  }
  return nodes
}
