/**
 * Geometry for PBI shapes (`shape.tileShape`). Every shape becomes one SVG path within the
 * box [x, y, w, h] (the caller insets the box by half the outline weight so strokes stay inside).
 * Proportions follow Power BI's built-in shapes (arrow head 50% / shaft 50%, chevron notch 1/3,
 * speech bubble tail bottom-left, tab corners = radius).
 */

export const SHAPE_KINDS = [
  'rectangle',
  'rectangleRounded',
  'oval',
  'line',
  'triangle',
  'rightTriangle',
  'arrow',
  'arrowUp',
  'arrowDown',
  'arrowLeft',
  'chevron',
  'pentagon',
  'hexagon',
  'octagon',
  'parallelogram',
  'trapezoid',
  'diamond',
  'star',
  'heart',
  'plus',
  'cross',
  'speechBubble',
  'tabCutCorner',
  'tabCutTopCorners',
  'tabRoundCorner',
  'tabRoundTopCorners'
] as const

export type ShapeKind = (typeof SHAPE_KINDS)[number]

const ALIASES: Record<string, ShapeKind> = {
  ellipse: 'oval',
  circle: 'oval',
  roundedrectangle: 'rectangleRounded',
  rectanglerounded: 'rectangleRounded',
  arrowright: 'arrow',
  rightarrow: 'arrow',
  uparrow: 'arrowUp',
  downarrow: 'arrowDown',
  leftarrow: 'arrowLeft',
  callout: 'speechBubble',
  speechbubble: 'speechBubble',
  isoscelestriangle: 'triangle',
  righttriangle: 'rightTriangle',
  x: 'cross'
}

export function normalizeShapeKind(v: unknown): ShapeKind {
  const s = String(v ?? 'rectangle')
  if ((SHAPE_KINDS as readonly string[]).includes(s)) return s as ShapeKind
  const k = s.replace(/[\s_-]/g, '').toLowerCase()
  if (ALIASES[k]) return ALIASES[k]
  const hit = SHAPE_KINDS.find((x) => x.toLowerCase() === k)
  return hit ?? 'rectangle'
}

const f = (n: number) => (Math.round(n * 100) / 100).toString()

function poly(points: Array<[number, number]>): string {
  return points.map(([x, y], i) => `${i ? 'L' : 'M'}${f(x)} ${f(y)}`).join(' ') + ' Z'
}

function regular(n: number, x: number, y: number, w: number, h: number, rotation: number): string {
  const cx = x + w / 2
  const cy = y + h / 2
  const pts: Array<[number, number]> = []
  for (let i = 0; i < n; i++) {
    const a = rotation + (i * 2 * Math.PI) / n
    pts.push([cx + (w / 2) * Math.cos(a), cy + (h / 2) * Math.sin(a)])
  }
  return poly(pts)
}

function roundedRect(x: number, y: number, w: number, h: number, r: [number, number, number, number]): string {
  const [tl, tr, br, bl] = r.map((v) => Math.max(0, Math.min(v, w / 2, h / 2)))
  return [
    `M${f(x + tl)} ${f(y)}`,
    `L${f(x + w - tr)} ${f(y)}`,
    tr ? `A${f(tr)} ${f(tr)} 0 0 1 ${f(x + w)} ${f(y + tr)}` : '',
    `L${f(x + w)} ${f(y + h - br)}`,
    br ? `A${f(br)} ${f(br)} 0 0 1 ${f(x + w - br)} ${f(y + h)}` : '',
    `L${f(x + bl)} ${f(y + h)}`,
    bl ? `A${f(bl)} ${f(bl)} 0 0 1 ${f(x)} ${f(y + h - bl)}` : '',
    `L${f(x)} ${f(y + tl)}`,
    tl ? `A${f(tl)} ${f(tl)} 0 0 1 ${f(x + tl)} ${f(y)}` : '',
    'Z'
  ]
    .filter(Boolean)
    .join(' ')
}

export interface ShapeOptions {
  /** rounded corner radius in px (rectangleRounded / tab shapes) */
  radius?: number
}

/** SVG path data for a shape inside the box. */
export function shapePath(kind: ShapeKind, x: number, y: number, w: number, h: number, opts: ShapeOptions = {}): string {
  w = Math.max(0, w)
  h = Math.max(0, h)
  const r = opts.radius ?? Math.min(w, h) * 0.1
  switch (kind) {
    case 'rectangle':
      return poly([
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h]
      ])
    case 'rectangleRounded':
      return roundedRect(x, y, w, h, [r, r, r, r])
    case 'oval': {
      const rx = w / 2
      const ry = h / 2
      return `M${f(x)} ${f(y + ry)} A${f(rx)} ${f(ry)} 0 1 0 ${f(x + w)} ${f(y + ry)} A${f(rx)} ${f(ry)} 0 1 0 ${f(x)} ${f(y + ry)} Z`
    }
    case 'line':
      return `M${f(x)} ${f(y + h / 2)} L${f(x + w)} ${f(y + h / 2)}`
    case 'triangle':
      return poly([
        [x + w / 2, y],
        [x + w, y + h],
        [x, y + h]
      ])
    case 'rightTriangle':
      return poly([
        [x, y],
        [x + w, y + h],
        [x, y + h]
      ])
    case 'arrow':
    case 'arrowUp':
    case 'arrowDown':
    case 'arrowLeft': {
      // right-pointing arrow in a unit box, then rotated by mapping
      const unit: Array<[number, number]> = [
        [0, 0.25],
        [0.5, 0.25],
        [0.5, 0],
        [1, 0.5],
        [0.5, 1],
        [0.5, 0.75],
        [0, 0.75]
      ]
      const map = (p: [number, number]): [number, number] => {
        const [u, v] = p
        switch (kind) {
          case 'arrowLeft':
            return [x + (1 - u) * w, y + v * h]
          case 'arrowUp':
            return [x + v * w, y + (1 - u) * h]
          case 'arrowDown':
            return [x + v * w, y + u * h]
          default:
            return [x + u * w, y + v * h]
        }
      }
      return poly(unit.map(map))
    }
    case 'chevron': {
      const n = Math.min(w / 3, h / 2)
      return poly([
        [x, y],
        [x + w - n, y],
        [x + w, y + h / 2],
        [x + w - n, y + h],
        [x, y + h],
        [x + n, y + h / 2]
      ])
    }
    case 'pentagon':
      return regular(5, x, y, w, h, -Math.PI / 2)
    case 'hexagon':
      return poly([
        [x + w * 0.25, y],
        [x + w * 0.75, y],
        [x + w, y + h / 2],
        [x + w * 0.75, y + h],
        [x + w * 0.25, y + h],
        [x, y + h / 2]
      ])
    case 'octagon': {
      const c = Math.min(w, h) * 0.29
      return poly([
        [x + c, y],
        [x + w - c, y],
        [x + w, y + c],
        [x + w, y + h - c],
        [x + w - c, y + h],
        [x + c, y + h],
        [x, y + h - c],
        [x, y + c]
      ])
    }
    case 'parallelogram': {
      const s = w * 0.25
      return poly([
        [x + s, y],
        [x + w, y],
        [x + w - s, y + h],
        [x, y + h]
      ])
    }
    case 'trapezoid': {
      const s = w * 0.2
      return poly([
        [x + s, y],
        [x + w - s, y],
        [x + w, y + h],
        [x, y + h]
      ])
    }
    case 'diamond':
      return poly([
        [x + w / 2, y],
        [x + w, y + h / 2],
        [x + w / 2, y + h],
        [x, y + h / 2]
      ])
    case 'star': {
      const pts: Array<[number, number]> = []
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5
        const k = i % 2 ? 0.4 : 1
        pts.push([x + w / 2 + (w / 2) * k * Math.cos(a), y + h / 2 + (h / 2) * k * Math.sin(a)])
      }
      return poly(pts)
    }
    case 'heart': {
      const X = (u: number) => f(x + u * w)
      const Y = (v: number) => f(y + v * h)
      return [
        `M${X(0.5)} ${Y(0.25)}`,
        `C${X(0.5)} ${Y(0.1)} ${X(0.35)} ${Y(0)} ${X(0.25)} ${Y(0)}`,
        `C${X(0.1)} ${Y(0)} ${X(0)} ${Y(0.12)} ${X(0)} ${Y(0.3)}`,
        `C${X(0)} ${Y(0.55)} ${X(0.3)} ${Y(0.75)} ${X(0.5)} ${Y(1)}`,
        `C${X(0.7)} ${Y(0.75)} ${X(1)} ${Y(0.55)} ${X(1)} ${Y(0.3)}`,
        `C${X(1)} ${Y(0.12)} ${X(0.9)} ${Y(0)} ${X(0.75)} ${Y(0)}`,
        `C${X(0.65)} ${Y(0)} ${X(0.5)} ${Y(0.1)} ${X(0.5)} ${Y(0.25)} Z`
      ].join(' ')
    }
    case 'plus': {
      const a = 1 / 3
      const b = 2 / 3
      return poly(
        (
          [
            [a, 0],
            [b, 0],
            [b, a],
            [1, a],
            [1, b],
            [b, b],
            [b, 1],
            [a, 1],
            [a, b],
            [0, b],
            [0, a],
            [a, a]
          ] as Array<[number, number]>
        ).map(([u, v]) => [x + u * w, y + v * h])
      )
    }
    case 'cross': {
      const t = 0.18
      const pts: Array<[number, number]> = [
        [t, 0],
        [0.5, 0.5 - t],
        [1 - t, 0],
        [1, t],
        [0.5 + t, 0.5],
        [1, 1 - t],
        [1 - t, 1],
        [0.5, 0.5 + t],
        [t, 1],
        [0, 1 - t],
        [0.5 - t, 0.5],
        [0, t]
      ]
      return poly(pts.map(([u, v]) => [x + u * w, y + v * h]))
    }
    case 'speechBubble': {
      const bh = h * 0.8
      const rr = Math.min(r, w / 2, bh / 2)
      return [
        `M${f(x + rr)} ${f(y)}`,
        `L${f(x + w - rr)} ${f(y)}`,
        `A${f(rr)} ${f(rr)} 0 0 1 ${f(x + w)} ${f(y + rr)}`,
        `L${f(x + w)} ${f(y + bh - rr)}`,
        `A${f(rr)} ${f(rr)} 0 0 1 ${f(x + w - rr)} ${f(y + bh)}`,
        `L${f(x + w * 0.35)} ${f(y + bh)}`,
        `L${f(x + w * 0.15)} ${f(y + h)}`,
        `L${f(x + w * 0.2)} ${f(y + bh)}`,
        `L${f(x + rr)} ${f(y + bh)}`,
        `A${f(rr)} ${f(rr)} 0 0 1 ${f(x)} ${f(y + bh - rr)}`,
        `L${f(x)} ${f(y + rr)}`,
        `A${f(rr)} ${f(rr)} 0 0 1 ${f(x + rr)} ${f(y)} Z`
      ].join(' ')
    }
    case 'tabCutCorner': {
      const c = Math.min(r || Math.min(w, h) * 0.2, w, h)
      return poly([
        [x, y],
        [x + w - c, y],
        [x + w, y + c],
        [x + w, y + h],
        [x, y + h]
      ])
    }
    case 'tabCutTopCorners': {
      const c = Math.min(r || Math.min(w, h) * 0.2, w / 2, h)
      return poly([
        [x + c, y],
        [x + w - c, y],
        [x + w, y + c],
        [x + w, y + h],
        [x, y + h],
        [x, y + c]
      ])
    }
    case 'tabRoundCorner':
      return roundedRect(x, y, w, h, [0, r || Math.min(w, h) * 0.2, 0, 0])
    case 'tabRoundTopCorners': {
      const c = r || Math.min(w, h) * 0.2
      return roundedRect(x, y, w, h, [c, c, 0, 0])
    }
  }
}

/** Shapes that are open strokes (no fill). */
export function isStrokeOnly(kind: ShapeKind): boolean {
  return kind === 'line'
}
