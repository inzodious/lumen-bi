/**
 * Report theme resolution: base theme (e.g. CY24SU10) + custom theme JSON → ResolvedTheme.
 * Custom theme top-level keys override the base; `visualStyles` and `textClasses` deep-merge.
 */
import baseThemeJson from './themes/CY24SU10.json'

export interface TextClass {
  fontSize?: number
  fontFace?: string
  color?: string
  bold?: boolean
  italic?: boolean
}

export interface ResolvedTheme {
  name: string
  dataColors: string[]
  foreground: string
  foregroundNeutralSecondary: string
  foregroundNeutralTertiary: string
  background: string
  backgroundLight: string
  backgroundNeutral: string
  tableAccent: string
  good: string
  neutral: string
  bad: string
  maximum: string
  center: string
  minimum: string
  null: string
  hyperlink: string
  textClasses: Record<string, TextClass>
  /** visualStyles[visualType|'*'][styleName|'*'][objectName] = array of property bags (first without $id is default) */
  visualStyles: Record<string, Record<string, Record<string, Array<Record<string, any>>>>>
  /** the merged raw JSON (other keys like icons, sentiment colors...) */
  raw: Record<string, any>
}

export const DEFAULT_BASE_THEME: any = baseThemeJson

function isPlainObject(v: unknown): v is Record<string, any> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function deepMerge(a: any, b: any): any {
  if (b === undefined) return a
  if (isPlainObject(a) && isPlainObject(b)) {
    const out: Record<string, any> = { ...a }
    for (const [k, v] of Object.entries(b)) out[k] = deepMerge(a[k], v)
    return out
  }
  if (Array.isArray(a) && Array.isArray(b) && a.length && b.length && isPlainObject(a[0]) && isPlainObject(b[0])) {
    // visualStyles object arrays: merge element 0 (default selector) and keep others from b (by $id)
    const out = a.map((x) => ({ ...x }))
    for (const item of b) {
      const idx = out.findIndex((x) => (x.$id ?? null) === (item.$id ?? null))
      if (idx >= 0) out[idx] = deepMerge(out[idx], item)
      else out.push(item)
    }
    return out
  }
  return b
}

export function resolveTheme(base?: any, custom?: any): ResolvedTheme {
  const merged = deepMerge(deepMerge({}, base ?? DEFAULT_BASE_THEME), custom ?? {})
  const fg = merged.foreground ?? '#252423'
  return {
    name: merged.name ?? 'Theme',
    dataColors: merged.dataColors ?? DEFAULT_BASE_THEME.dataColors,
    foreground: fg,
    foregroundNeutralSecondary: merged.foregroundNeutralSecondary ?? '#605E5C',
    foregroundNeutralTertiary: merged.foregroundNeutralTertiary ?? '#B3B0AD',
    background: merged.background ?? '#FFFFFF',
    backgroundLight: merged.backgroundLight ?? '#F3F2F1',
    backgroundNeutral: merged.backgroundNeutral ?? '#C8C6C4',
    tableAccent: merged.tableAccent ?? merged.dataColors?.[0] ?? '#118DFF',
    good: merged.good ?? '#1AAB40',
    neutral: merged.neutral ?? '#D9B300',
    bad: merged.bad ?? '#D64554',
    maximum: merged.maximum ?? '#118DFF',
    center: merged.center ?? '#D9B300',
    minimum: merged.minimum ?? '#DEEFFF',
    null: merged.null ?? '#FF7F48',
    hyperlink: merged.hyperlink ?? '#0078d4',
    textClasses: merged.textClasses ?? {},
    visualStyles: merged.visualStyles ?? {},
    raw: merged
  }
}

/** Theme color by SQ ThemeDataColor id: 0 = background, 1 = foreground, 2.. = dataColors[id-2]. Percent tints (+) / shades (-). */
export function themeDataColor(theme: ResolvedTheme, colorId: number, percent = 0): string {
  const base = colorId === 0 ? theme.background : colorId === 1 ? theme.foreground : theme.dataColors[(colorId - 2) % theme.dataColors.length]
  return percent ? shadeColor(base, percent) : base
}

/** Palette color for the n-th series/category. */
export function seriesColor(theme: ResolvedTheme, index: number): string {
  const colors = theme.dataColors
  return colors[((index % colors.length) + colors.length) % colors.length]
}

export function parseHex(hex: string): [number, number, number, number] {
  let h = hex.trim().replace('#', '')
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const n = parseInt(h.slice(0, 6), 16)
  const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a]
}

export function toHex(r: number, g: number, b: number): string {
  const c = (x: number) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase()
}

/** percent in [-1, 1]: positive mixes toward white, negative toward black. */
export function shadeColor(hex: string, percent: number): string {
  if (!hex?.startsWith('#')) return hex
  const [r, g, b] = parseHex(hex)
  if (percent >= 0) return toHex(r + (255 - r) * percent, g + (255 - g) * percent, b + (255 - b) * percent)
  const p = 1 + percent
  return toHex(r * p, g * p, b * p)
}

/** Apply PBI "transparency" (0..100) to a hex color → rgba(). */
export function withTransparency(color: string, transparency?: number | null): string {
  if (!transparency || !color?.startsWith('#')) return color
  const [r, g, b] = parseHex(color)
  return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, 1 - transparency / 100))})`
}
