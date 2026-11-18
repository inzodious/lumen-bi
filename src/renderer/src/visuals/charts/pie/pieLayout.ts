/**
 * Pie / donut geometry and detail-label layout (pure).
 *
 * Power BI starts the first slice at 12 o'clock and goes clockwise. Outside labels sit at the
 * slice's mid-angle with a two-segment leader line; labels on each side are pushed apart
 * vertically so they never overlap, and dropped when they can't fit.
 */
export interface SliceAngle {
  start: number
  end: number
  mid: number
}

/** Angles (radians, 0 = 12 o'clock, clockwise) for non-negative values; `rotation` in degrees (slices.startAngle). */
export function sliceAngles(values: number[], rotation = 0): SliceAngle[] {
  const total = values.reduce((a, v) => a + Math.max(0, v), 0)
  let acc = (rotation * Math.PI) / 180
  return values.map((v) => {
    const a = total > 0 ? (Math.max(0, v) / total) * Math.PI * 2 : 0
    const s = { start: acc, end: acc + a, mid: acc + a / 2 }
    acc += a
    return s
  })
}

/** Point at angle (0 = up, clockwise) and radius. */
export function polar(cx: number, cy: number, r: number, a: number): [number, number] {
  return [cx + r * Math.sin(a), cy - r * Math.cos(a)]
}

/** SVG path for an annular sector. */
export function arcPath(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  if (a1 - a0 >= Math.PI * 2 - 1e-6) {
    // full circle: two halves
    const half = a0 + Math.PI
    return arcPath(cx, cy, r0, r1, a0, half) + arcPath(cx, cy, r0, r1, half, a0 + Math.PI * 2)
  }
  const large = a1 - a0 > Math.PI ? 1 : 0
  const [x0, y0] = polar(cx, cy, r1, a0)
  const [x1, y1] = polar(cx, cy, r1, a1)
  if (r0 <= 0) return `M${cx},${cy}L${x0},${y0}A${r1},${r1} 0 ${large} 1 ${x1},${y1}Z`
  const [x2, y2] = polar(cx, cy, r0, a1)
  const [x3, y3] = polar(cx, cy, r0, a0)
  return `M${x0},${y0}A${r1},${r1} 0 ${large} 1 ${x1},${y1}L${x2},${y2}A${r0},${r0} 0 ${large} 0 ${x3},${y3}Z`
}

export interface PieLabelIn {
  index: number
  mid: number
  /** label height in px */
  height: number
}

export interface PieLabelOut {
  index: number
  side: 'left' | 'right'
  /** anchor of text (x at text start/end, y centre) */
  x: number
  y: number
  /** leader polyline */
  line: Array<[number, number]>
}

/**
 * Lay out outside labels: start at the radial position r + 10 then resolve collisions per side by
 * a top-down sweep (push down) followed by a bottom-up sweep (push up) within [top, bottom].
 */
export function layoutOutsideLabels(labels: PieLabelIn[], cx: number, cy: number, r: number, top: number, bottom: number): PieLabelOut[] {
  const out: PieLabelOut[] = []
  for (const side of ['right', 'left'] as const) {
    const items = labels
      .filter((l) => (side === 'right' ? l.mid <= Math.PI : l.mid > Math.PI))
      .map((l) => {
        const [, y] = polar(cx, cy, r + 12, l.mid)
        return { ...l, y }
      })
      .sort((a, b) => a.y - b.y)
    // push down
    let cursor = top
    for (const it of items) {
      it.y = Math.max(it.y, cursor + it.height / 2)
      cursor = it.y + it.height / 2
    }
    // push up from the bottom
    cursor = bottom
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i]
      it.y = Math.min(it.y, cursor - it.height / 2)
      cursor = it.y - it.height / 2
    }
    for (const it of items) {
      if (it.y - it.height / 2 < top - 0.5) continue // doesn't fit at all
      const [ex, ey] = polar(cx, cy, r, it.mid)
      const [bx, by] = polar(cx, cy, r + 8, it.mid)
      const elbowX = side === 'right' ? Math.max(bx, cx + r * 0.2) : Math.min(bx, cx - r * 0.2)
      const textX = side === 'right' ? Math.max(cx + r + 14, elbowX + 8) : Math.min(cx - r - 14, elbowX - 8)
      out.push({
        index: it.index,
        side,
        x: textX + (side === 'right' ? 3 : -3),
        y: it.y,
        line: [
          [ex, ey],
          [elbowX, Math.abs(it.y - by) < 2 ? it.y : by],
          [textX, it.y]
        ]
      })
    }
  }
  return out
}

/**
 * PBI label contents option → which parts are shown. Values written by Desktop: "Category",
 * "Data" / "Data value", "Percent of total", "Both" / "Category, data value",
 * "Category, percent of total", "Data value, percent of total",
 * "Category, data value, percent of total" / "All detail labels".
 */
export function labelParts(style: string): { category: boolean; value: boolean; percent: boolean } {
  const s = style.toLowerCase().trim()
  if (s === 'all detail labels') return { category: true, value: true, percent: true }
  if (s === 'both') return { category: true, value: true, percent: false }
  if (s === 'data') return { category: false, value: true, percent: false }
  return { category: s.includes('category'), value: s.includes('data'), percent: s.includes('percent') }
}

/**
 * Compose the detail label like PBI: the first part plain, the others in parentheses —
 * "$6.39M (28.97%)", "Lindseys ($6M)", "Lindseys $6M (28.97%)".
 */
export function composeLabel(parts: { category?: string; value?: string; percent?: string }): string {
  const { category, value, percent } = parts
  if (category && value && percent) return `${category} ${value} (${percent})`
  const bits = [category, value, percent].filter((b): b is string => !!b)
  if (bits.length <= 1) return bits[0] ?? ''
  return `${bits[0]} (${bits[1]})`
}

/** Split a composed label into two lines at the parenthesis (PBI wraps before truncating). */
export function splitLabel(text: string): [string, string] | null {
  const i = text.lastIndexOf(' (')
  if (i > 0) return [text.slice(0, i), text.slice(i + 1)]
  const j = text.indexOf(' ')
  return j > 0 ? [text.slice(0, j), text.slice(j + 1)] : null
}
