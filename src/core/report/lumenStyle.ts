/**
 * Lumen-only visual container effects: gradient fills, frosted glass, glow and rotation.
 *
 * Power BI's container formatting has a solid background, a border and a drop shadow. Lumen adds a few
 * effects on top, stored in the visual's `annotations` (visualContainer schema: an array of `{ name, value }`
 * strings that Power BI Desktop preserves and ignores) under the name `Lumen_Style`, value a JSON object:
 *
 *   {
 *     "gradient": { "angle": 135, "stops": ["#7B5CFF", "#FF5FA2"] },   // replaces the background color
 *     "radial":   { "at": "30% 20%", "stops": ["#FFFFFF33", "#FFFFFF00"] }, // layered over the fill
 *     "blur": 14,                                                      // backdrop blur in px (frosted glass)
 *     "glow": { "color": "#3BF0FF", "size": 18, "opacity": 0.55 },     // outer glow, added to the drop shadow
 *     "rotate": -3                                                      // degrees, the box only (selection stays upright)
 *   }
 *
 * Power BI Desktop opens such a report and draws the container with its ordinary formatting (the solid
 * background, border and shadow), so a template should set those as the plain fallback.
 */

export const LUMEN_STYLE_ANNOTATION = 'Lumen_Style'

export interface LumenStyle {
  gradient?: { angle: number; stops: string[] }
  radial?: { at: string; stops: string[] }
  blur?: number
  glow?: { color: string; size: number; opacity: number }
  rotate?: number
}

const COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const AT = /^\d{1,3}% \d{1,3}%$/

function num(v: unknown, min: number, max: number): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : undefined
}

function stops(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const s = v.filter((x): x is string => typeof x === 'string' && COLOR.test(x)).slice(0, 6)
  return s.length >= 2 ? s : undefined
}

/** Parse and sanitise a `Lumen_Style` value (colors must be hex, numbers are clamped); undefined when empty or invalid. */
export function parseLumenStyle(value: unknown): LumenStyle | undefined {
  let o: any = value
  if (typeof value === 'string') {
    try {
      o = JSON.parse(value)
    } catch {
      return undefined
    }
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return undefined
  const out: LumenStyle = {}
  const g = o.gradient
  const gs = g && stops(g.stops)
  if (gs) out.gradient = { angle: num(g.angle, -360, 360) ?? 180, stops: gs }
  const r = o.radial
  const rs = r && stops(r.stops)
  if (rs) out.radial = { at: typeof r.at === 'string' && AT.test(r.at) ? r.at : '50% 50%', stops: rs }
  const blur = num(o.blur, 0, 60)
  if (blur) out.blur = blur
  const gl = o.glow
  if (gl && typeof gl.color === 'string' && COLOR.test(gl.color)) out.glow = { color: gl.color, size: num(gl.size, 1, 80) ?? 16, opacity: num(gl.opacity, 0, 1) ?? 0.5 }
  const rot = num(o.rotate, -45, 45)
  if (rot) out.rotate = rot
  return Object.keys(out).length ? out : undefined
}

/** The `Lumen_Style` of a visual container JSON, if any. */
export function lumenStyleOf(visualJson: any): LumenStyle | undefined {
  const list = visualJson?.annotations
  if (!Array.isArray(list)) return undefined
  const a = list.find((x: any) => x && x.name === LUMEN_STYLE_ANNOTATION)
  return a ? parseLumenStyle(a.value) : undefined
}

function rgba(hex: string, opacity: number): string {
  let h = hex.slice(1)
  if (h.length <= 4) h = [...h].map((ch) => ch + ch).join('')
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16)
  const a = (h.length === 8 ? n(6) / 255 : 1) * opacity
  return `rgba(${n(0)}, ${n(2)}, ${n(4)}, ${Math.round(a * 1000) / 1000})`
}

/** CSS for the container box. `background` replaces the solid fill when a gradient is set. */
export function lumenStyleCss(s: LumenStyle, solid: string | undefined): { background?: string; backdropFilter?: string; glow?: string; transform?: string } {
  const layers: string[] = []
  if (s.radial) layers.push(`radial-gradient(circle at ${s.radial.at}, ${s.radial.stops.join(', ')})`)
  if (s.gradient) layers.push(`linear-gradient(${s.gradient.angle}deg, ${s.gradient.stops.join(', ')})`)
  else if (layers.length && solid) layers.push(/^(linear|radial)-gradient\(/.test(solid) ? solid : `linear-gradient(${solid}, ${solid})`)
  return {
    ...(layers.length ? { background: layers.join(', ') } : {}),
    ...(s.blur ? { backdropFilter: `blur(${s.blur}px) saturate(140%)` } : {}),
    ...(s.glow ? { glow: `0 0 ${s.glow.size}px ${rgba(s.glow.color, s.glow.opacity)}` } : {}),
    ...(s.rotate ? { transform: `rotate(${s.rotate}deg)` } : {})
  }
}
