import { useId } from 'react'
import { isStrokeOnly, shapePath, type ShapeKind } from './shapes'
import { SvgGradientDef, svgPaintRef, type SvgPaint } from '../common/svgPaint'

export interface ShadowSpec {
  color: string
  /** px offsets */
  dx: number
  dy: number
  blur: number
}

export interface GlowSpec {
  color: string
  blur: number
}

export interface ShapeSvgProps {
  kind: ShapeKind
  width: number
  height: number
  radius?: number
  fill?: string
  stroke?: string
  /** Lumen gradient fill drawn instead of `fill` (which stays the solid fallback) */
  fillPaint?: SvgPaint
  /** Lumen gradient outline drawn instead of `stroke` */
  strokePaint?: SvgPaint
  strokeWidth?: number
  rotation?: number
  shadow?: ShadowSpec
  glow?: GlowSpec
}

/** One PBI shape drawn into a w×h SVG (outline kept inside the box; rotation around the center). */
export function ShapeSvg(p: ShapeSvgProps) {
  const id = useId().replace(/:/g, '')
  const sw = p.stroke ? Math.max(0, p.strokeWidth ?? 1) : 0
  const inset = sw / 2
  const d = shapePath(p.kind, inset, inset, p.width - sw, p.height - sw, { radius: p.radius })
  const strokeOnly = isStrokeOnly(p.kind)
  const filters: string[] = []
  if (p.shadow) filters.push(`url(#sh${id})`)
  if (p.glow) filters.push(`url(#gl${id})`)
  // a line's box has no height, so a bounding-box gradient can't paint it: lines keep the solid color
  const fillPaint = p.fill && !strokeOnly ? p.fillPaint : undefined
  const strokePaint = p.stroke && !strokeOnly ? p.strokePaint : undefined
  const fill = fillPaint ? svgPaintRef(fillPaint) : p.fill
  const stroke = strokePaint ? svgPaintRef(strokePaint) : p.stroke
  const paints = [fillPaint, strokePaint].filter((x): x is SvgPaint => !!x)
  return (
    <svg width={p.width} height={p.height} style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}>
      {(p.shadow || p.glow || paints.length > 0) && (
        <defs>
          {paints.map((pt, i) => (
            <SvgGradientDef key={i} paint={pt} />
          ))}
          {p.shadow && (
            <filter id={`sh${id}`} x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx={p.shadow.dx} dy={p.shadow.dy} stdDeviation={p.shadow.blur / 2} floodColor={p.shadow.color} />
            </filter>
          )}
          {p.glow && (
            <filter id={`gl${id}`} x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx={0} dy={0} stdDeviation={p.glow.blur / 2} floodColor={p.glow.color} />
            </filter>
          )}
        </defs>
      )}
      <g transform={p.rotation ? `rotate(${p.rotation} ${p.width / 2} ${p.height / 2})` : undefined} filter={filters.length ? filters[0] : undefined}>
        <g filter={filters.length > 1 ? filters[1] : undefined}>
          <path
            d={strokeOnly ? shapePath(p.kind, 0, 0, p.width, p.height) : d}
            fill={strokeOnly ? 'none' : fill ?? 'none'}
            stroke={strokeOnly ? stroke ?? fill ?? '#000' : stroke ?? 'none'}
            strokeWidth={strokeOnly ? Math.max(1, sw || 1) : sw}
            strokeLinejoin="round"
          />
        </g>
      </g>
    </svg>
  )
}
