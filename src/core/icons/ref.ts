/**
 * Icon references: parse / serialise, colour values (literal hex or report theme colours), resolution
 * of a reference's colours through the report theme (so an icon follows a theme change).
 */
import { shadeColor, themeDataColor, type ResolvedTheme } from '../report/theme'
import { ICON_SETS, variantSpec } from './sets'
import { isIconSetId, type IconColor, type IconRef, type VariantSpec } from './types'

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/
const THEME = /^theme:(\d+)(?::(-?\d*\.?\d+))?$/

export interface ThemeColorParts {
  colorId: number
  percent: number
}

export function isIconColor(v: unknown): v is IconColor {
  return typeof v === 'string' && (HEX.test(v) || THEME.test(v))
}

/** `theme:2`, `theme:2:0.4` → parts; anything else → undefined. */
export function themeColorParts(c: IconColor): ThemeColorParts | undefined {
  const m = THEME.exec(c)
  return m ? { colorId: Number(m[1]), percent: m[2] ? Number(m[2]) : 0 } : undefined
}

export function themeColor(colorId: number, percent = 0): IconColor {
  return percent ? `theme:${colorId}:${Math.round(percent * 1000) / 1000}` : `theme:${colorId}`
}

/** Normalise a hex colour to upper-case #RRGGBB. */
export function normHex(hex: string): string {
  let h = hex.replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  return `#${h.slice(0, 6).toUpperCase()}`
}

/** A stored colour → hex through the theme (theme colours need one; without it the base theme's palette is assumed by the caller). */
export function resolveIconColor(c: IconColor, theme: ResolvedTheme): string {
  const t = themeColorParts(c)
  if (t) return normHex(themeDataColor(theme, t.colorId, t.percent))
  return HEX.test(c) ? normHex(c) : '#000000'
}

/** The variant of a reference, falling back to the set's default (unknown variant). */
export function refVariant(ref: IconRef): VariantSpec {
  return variantSpec(ref.set, ref.variant) ?? variantSpec(ref.set, ICON_SETS[ref.set].defaultVariant)!
}

/** The stored colour of each slot (null = default) — the colour value, before theme resolution. */
export function slotColors(ref: IconRef): Array<IconColor | { derive: number; percent: number }> {
  return refVariant(ref).slots.map((s, i) => {
    const c = ref.colors?.[i]
    return typeof c === 'string' && isIconColor(c) ? c : s.default
  })
}

/** Hex colour of every colour slot of the reference's variant (defaults and derived slots applied). */
export function resolveIconColors(ref: IconRef, theme: ResolvedTheme): string[] {
  const vals = slotColors(ref)
  const out: string[] = vals.map((v) => (typeof v === 'string' ? resolveIconColor(v, theme) : ''))
  vals.forEach((v, i) => {
    if (typeof v !== 'string') out[i] = normHex(shadeColor(out[v.derive] || '#000000', v.percent))
  })
  return out
}

/** Theme colour ids a reference depends on (for theme-change re-bakes). */
export function usesThemeColors(ref: IconRef): boolean {
  return slotColors(ref).some((v) => typeof v !== 'string' || themeColorParts(v) !== undefined)
}

/** Compact id used for keys, recents and tests: `set:name@variant`. */
export function iconKey(ref: Pick<IconRef, 'set' | 'name' | 'variant'>): string {
  return `${ref.set}:${ref.name}@${ref.variant}`
}

/** Validate + normalise an untrusted reference (from a file). Returns undefined when it is not one. */
export function parseIconRef(v: unknown): IconRef | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  if (!isIconSetId(o['set']) || typeof o['name'] !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(o['name'])) return undefined
  const ref: IconRef = { set: o['set'], name: o['name'], variant: typeof o['variant'] === 'string' ? o['variant'] : ICON_SETS[o['set']].defaultVariant }
  if (!variantSpec(ref.set, ref.variant)) ref.variant = ICON_SETS[ref.set].defaultVariant
  if (Array.isArray(o['colors'])) ref.colors = o['colors'].map((c) => (isIconColor(c) ? c : null))
  if (typeof o['strokeWidth'] === 'number' && Number.isFinite(o['strokeWidth']) && o['strokeWidth'] > 0) ref.strokeWidth = o['strokeWidth']
  if (typeof o['padding'] === 'number' && Number.isFinite(o['padding'])) ref.padding = Math.max(0, Math.min(40, o['padding']))
  return ref
}

/** Canonical JSON-able form (stable key order, defaults dropped). */
export function serializeIconRef(ref: IconRef): IconRef {
  const out: IconRef = { set: ref.set, name: ref.name, variant: ref.variant }
  const slots = refVariant(ref).slots.length
  const colors = (ref.colors ?? []).slice(0, slots).map((c) => (c && isIconColor(c) ? c : null))
  while (colors.length && colors[colors.length - 1] === null) colors.pop()
  if (colors.length) out.colors = colors
  const stroke = refVariant(ref).stroke
  if (stroke && ref.strokeWidth !== undefined && ref.strokeWidth !== stroke.default) out.strokeWidth = ref.strokeWidth
  if (ref.padding) out.padding = ref.padding
  return out
}

/** A reference with another variant: colours carried over slot by slot, stroke kept when the new variant has strokes. */
export function withVariant(ref: IconRef, variant: string): IconRef {
  const next: IconRef = { ...ref, variant }
  const spec = variantSpec(ref.set, variant)
  if (!spec?.stroke) delete next.strokeWidth
  if (ref.colors) next.colors = ref.colors.slice(0, spec?.slots.length ?? 0)
  return next
}

/** Readable name: `chart-bar-vertical` → `Chart bar vertical`. */
export function iconTitle(name: string): string {
  const s = name.replace(/-/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}
