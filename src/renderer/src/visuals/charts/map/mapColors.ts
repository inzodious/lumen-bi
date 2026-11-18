/**
 * Map-specific coloring: "Color saturation" gradients (filled map / shape map / bubble map).
 *
 * Power BI stores the saturation gradient of the legacy color-saturation well as
 * `dataPoint.fillRule` (no input expression — it applies to the saturation measure) and may use the
 * placeholders 'minColor' / 'midColor' / 'maxColor' for "default". Those defaults are derived from
 * the data color here: min = a light tint, max = the color itself (APPROXIMATION of PBI's defaults).
 * Conditional formatting on `dataPoint.fill` (FillRule / rules / field value) is resolved by the
 * shared categorical builder and takes precedence.
 */
import { decodeValue, type PropContext } from '@core/report/props'
import type { ResolvedTheme } from '@core/report/theme'
import { evalFillRule, isWildcardSelector, mixColor } from '../../common/color'

const lit = (hex: string) => ({ Literal: { Value: `'${hex}'` } })

function colorNode(node: any, theme: ResolvedTheme): string | undefined {
  if (!node) return undefined
  const v = decodeValue(node.expr ? node : { expr: node }, theme)
  return typeof v === 'string' ? v : undefined
}

function unwrap(node: any): any {
  return node?.expr ?? node
}

/** Default gradient colors (light tint → base color) for a base data color. */
export function defaultGradient(base: string): { min: string; mid: string; max: string } {
  return { min: mixColor(base, '#FFFFFF', 0.82), mid: mixColor(base, '#FFFFFF', 0.45), max: base }
}

/**
 * Normalize a gradient rule (`{ linearGradient2 | linearGradient3 }`) so that evalFillRule can use it:
 * resolves placeholder / theme colors to hex literals and unwraps `{ expr: ... }` nodes.
 */
export function normalizeGradient(rule: any, base: string, theme: ResolvedTheme): any | undefined {
  const g2 = rule?.linearGradient2
  const g3 = rule?.linearGradient3
  const g = g2 ?? g3
  if (!g) return undefined
  const d = defaultGradient(base)
  const stop = (s: any, fallback: string) => {
    if (!s) return undefined
    const c = colorNode(s.color, theme)
    const hex = c && c.startsWith('#') ? c : fallback
    return { color: lit(hex), ...(s.value !== undefined ? { value: unwrap(s.value) } : {}) }
  }
  const out: any = {
    min: stop(g.min, d.min) ?? { color: lit(d.min) },
    max: stop(g.max, d.max) ?? { color: lit(d.max) }
  }
  if (g3) out.mid = stop(g3.mid, d.mid) ?? { color: lit(d.mid) }
  const strat = g.nullColoringStrategy
  if (strat) out.nullColoringStrategy = { strategy: unwrap(strat.strategy), ...(strat.color ? { color: unwrap(strat.color?.solid?.color ?? strat.color) } : {}) }
  return g3 ? { linearGradient3: out } : { linearGradient2: out }
}

/** The legacy `dataPoint.fillRule` gradient (default / wildcard entry), if any. */
export function legacySaturationRule(pc: PropContext): any | undefined {
  for (const e of pc.objects?.dataPoint ?? []) {
    if (e.selector?.metadata || (e.selector?.data && !isWildcardSelector(e.selector))) continue
    const r = e.properties?.fillRule
    if (r && (r.linearGradient2 || r.linearGradient3)) return r
  }
  return undefined
}

/** Colors for saturation values (null → no color unless the rule says otherwise). */
export function saturationColors(values: Array<number | null>, rule: any | undefined, base: string, theme: ResolvedTheme): Array<string | undefined> {
  const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  const range: [number, number] = nums.length ? [Math.min(...nums), Math.max(...nums)] : [0, 0]
  const norm = normalizeGradient(rule ?? { linearGradient2: {} }, base, theme)
  return values.map((v) => (norm ? evalFillRule(norm, v, range, theme) : undefined))
}
