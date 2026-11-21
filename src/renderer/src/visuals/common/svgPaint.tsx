/**
 * SVG side of Lumen gradient fills (core/report/gradientFill.ts): a `<linearGradient>` / `<radialGradient>` element
 * in objectBoundingBox units, so each shape filled with `url(#id)` gets the whole gradient across its own box.
 * Ids come from `gradientId` (stable per gradient + transparency), so identical gradients share one definition.
 */
import { gradientId, svgGradientGeometry, type GradientFill } from '@core/report/gradientFill'
import { parseHex } from '@core/report/theme'

export interface SvgPaint {
  gradient: GradientFill
  /** PBI transparency 0..100, applied to every stop */
  transparency?: number
}

export function SvgGradientDef({ paint, id = gradientId(paint.gradient, paint.transparency) }: { paint: SvgPaint; id?: string }) {
  const g = paint.gradient
  const k = 1 - Math.max(0, Math.min(100, paint.transparency ?? 0)) / 100
  const stops = g.stops.map((s, i) => {
    const a = parseHex(s.color)[3]
    return <stop key={i} offset={s.offset} stopColor={s.color.slice(0, 7)} stopOpacity={Math.round(a * k * 1000) / 1000} />
  })
  if (g.kind === 'radial')
    return (
      <radialGradient id={id} cx="0.5" cy="0.5" r="0.5">
        {stops}
      </radialGradient>
    )
  const { x1, y1, x2, y2 } = svgGradientGeometry(g)
  return (
    <linearGradient id={id} x1={x1} y1={y1} x2={x2} y2={y2}>
      {stops}
    </linearGradient>
  )
}

/** `fill` / `stroke` attribute value for a paint. */
export function svgPaintRef(paint: SvgPaint): string {
  return `url(#${gradientId(paint.gradient, paint.transparency)})`
}

/** The distinct gradient definitions of a set of paints (one `<defs>` child each). */
export function SvgGradientDefs({ paints }: { paints: Array<SvgPaint | undefined> }) {
  const seen = new Map<string, SvgPaint>()
  for (const p of paints) if (p) seen.set(gradientId(p.gradient, p.transparency), p)
  if (!seen.size) return null
  return (
    <defs>
      {[...seen].map(([id, p]) => (
        <SvgGradientDef key={id} id={id} paint={p} />
      ))}
    </defs>
  )
}
