/**
 * Icon references: parse / serialise, colour values (literal hex or report theme colours), resolution of a
 * reference's colour through the report theme (so an icon follows a theme change), names and keys.
 */
import { themeDataColor, type ResolvedTheme } from '../report/theme'
import { ICON_SETS } from './sets'
import { isIconSetId, type IconColor, type IconRef } from './types'

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/
const THEME = /^theme:(\d+)(?::(-?\d*\.?\d+))?$/
const NAME = /^[a-z0-9][a-z0-9-]*$/

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

/** A stored colour → hex through the theme. */
export function resolveIconColor(c: IconColor, theme: ResolvedTheme): string {
  const t = themeColorParts(c)
  if (t) return normHex(themeDataColor(theme, t.colorId, t.percent))
  return HEX.test(c) ? normHex(c) : '#000000'
}

/** The stored colour of a reference (its own, else the set's default); undefined for fixed-colour sets. */
export function iconColorValue(ref: IconRef): IconColor | undefined {
  const spec = ICON_SETS[ref.set]
  if (!spec.colorable) return undefined
  return ref.color && isIconColor(ref.color) ? ref.color : spec.defaultColor
}

/** The hex colour a single-colour icon is drawn in (undefined for fixed-colour sets). */
export function resolveRefColor(ref: IconRef, theme: ResolvedTheme): string | undefined {
  const c = iconColorValue(ref)
  return c ? resolveIconColor(c, theme) : undefined
}

/** The stroke width a reference is drawn with (undefined for sets without strokes). */
export function refStrokeWidth(ref: IconRef): number | undefined {
  const s = ICON_SETS[ref.set].stroke
  if (!s) return undefined
  const w = ref.strokeWidth
  return typeof w === 'number' && Number.isFinite(w) ? Math.max(s.min, Math.min(s.max, w)) : s.default
}

/** Does the reference's picture depend on the report theme (theme colour, own or default)? */
export function usesThemeColors(ref: IconRef): boolean {
  const c = iconColorValue(ref)
  return !!c && themeColorParts(c) !== undefined
}

/** Compact id used for keys, recents and tests: `set:name`. */
export function iconKey(ref: Pick<IconRef, 'set' | 'name'>): string {
  return `${ref.set}:${ref.name}`
}

/** Validate + normalise an untrusted reference (from a file). Returns undefined when it is not one of the current sets. */
export function parseIconRef(v: unknown): IconRef | undefined {
  if (!v || typeof v !== 'object') return undefined
  const o = v as Record<string, unknown>
  if (!isIconSetId(o['set']) || typeof o['name'] !== 'string' || !NAME.test(o['name'])) return undefined
  const ref: IconRef = { set: o['set'], name: o['name'] }
  const spec = ICON_SETS[ref.set]
  if (spec.colorable && isIconColor(o['color'])) ref.color = o['color']
  if (spec.stroke && typeof o['strokeWidth'] === 'number' && Number.isFinite(o['strokeWidth']) && o['strokeWidth'] > 0) ref.strokeWidth = o['strokeWidth']
  if (typeof o['padding'] === 'number' && Number.isFinite(o['padding'])) ref.padding = Math.max(0, Math.min(40, o['padding']))
  return ref
}

/** Canonical JSON-able form (stable key order; what does not apply to the set and defaults are dropped). */
export function serializeIconRef(ref: IconRef): IconRef {
  const spec = ICON_SETS[ref.set]
  const out: IconRef = { set: ref.set, name: ref.name }
  if (spec.colorable && ref.color && isIconColor(ref.color)) out.color = ref.color
  if (spec.stroke && ref.strokeWidth !== undefined && ref.strokeWidth !== spec.stroke.default) out.strokeWidth = ref.strokeWidth
  if (ref.padding) out.padding = ref.padding
  return out
}

/** Readable name: `chart-bar-vertical` → `Chart bar vertical`. */
export function iconTitle(name: string): string {
  const s = name.replace(/-/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * Icon name of a component export: library prefix / suffix removed, PascalCase → kebab-case, digits as their own
 * token (`LuChartBar` → `chart-bar`, `LuArrowDown01` → `arrow-down-01`, `DataBarVerticalAscendingColor` →
 * `data-bar-vertical-ascending`). Names are stable as long as the library keeps its export names.
 */
export function componentIconName(exportName: string, prefix = '', suffix = ''): string {
  let s = exportName
  if (prefix && s.startsWith(prefix)) s = s.slice(prefix.length)
  if (suffix && s.endsWith(suffix)) s = s.slice(0, -suffix.length)
  return s
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/([A-Za-z])([0-9])/g, '$1-$2')
    .replace(/([0-9])([A-Za-z])/g, '$1-$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1-$2')
    .toLowerCase()
}
