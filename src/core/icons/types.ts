/**
 * Built-in icon libraries — shared types (pure TS: no DOM, no React, no Node).
 *
 * An icon is referenced by `{ set, name, variant, colors, strokeWidth?, padding? }` (IconRef). Set data is
 * Iconify JSON normalised at build time (see normalize.ts and scripts/icons/icon-data-plugin.ts) into
 * IconSetData: per icon one SVG body per variant, with colour roles and stroke widths replaced by tokens:
 *
 *   {{0}} … {{3}}  colour role n (what a role means is set per set; see sets.ts)
 *   {{w:X}}        stroke width X in the artwork's own units, scaled by strokeWidth / the set's default
 *
 * Bodies use viewBox `0 0 size size` (IconSetData.size, or PackedIcon.s for icons drawn on another grid).
 */

export type IconSetId = 'fluent' | 'phosphor' | 'tabler' | 'iconpark'

/**
 * A colour as stored in an icon reference: a literal `#RRGGBB`, or a report theme colour
 * `theme:<ColorId>` / `theme:<ColorId>:<percent>` (ColorId as in PBIR ThemeDataColor: 0 = background,
 * 1 = foreground, 2.. = data colours; percent in [-1, 1] tints / shades like Power BI's theme swatches).
 */
export type IconColor = string

export interface IconRef {
  set: IconSetId
  /** icon name inside the set (stable: the set's own kebab-case name) */
  name: string
  variant: string
  /** one entry per colour slot of the variant; null / missing = the slot's default */
  colors?: Array<IconColor | null>
  /** stroke weight for sets whose variant supports it (units of the set's 24px or 48px grid) */
  strokeWidth?: number
  /** empty space around the glyph, % of the icon box (0–40) */
  padding?: number
}

/** A colour slot the user can set. `default` is a colour or `{ derive: slot, percent }` (follows another slot). */
export interface ColorSlotSpec {
  label: string
  default: IconColor | { derive: number; percent: number }
}

export interface VariantSpec {
  id: string
  label: string
  slots: ColorSlotSpec[]
  /**
   * What each colour role token of the body becomes: a slot index, or a literal colour ('none', '#FFFFFF').
   * Missing roles are left untouched.
   */
  roles: Array<number | string>
  /** default stroke width when the variant has adjustable strokes */
  stroke?: { default: number; min: number; max: number; step: number }
  /** IconPark: every variant is drawn from the same body (key '*') */
  sharedBody?: boolean
}

export interface IconSetSpec {
  id: IconSetId
  label: string
  /** shown in the picker and the notices */
  license: string
  author: string
  url: string
  variants: VariantSpec[]
  defaultVariant: string
}

/** A packed icon: SVG bodies per variant ('*' = shared by every variant), optional own grid size, categories. */
export interface PackedIcon {
  b: Record<string, string>
  /** grid size when it differs from the set's */
  s?: number
  /** the set's own categories for this icon */
  c?: string[]
}

export interface IconSetData {
  set: IconSetId
  /** default grid (viewBox) size */
  size: number
  /** upstream data version (Iconify `info.version`), for the notices / diagnostics */
  version?: string
  icons: Record<string, PackedIcon>
}

export const ICON_SET_IDS: readonly IconSetId[] = ['fluent', 'phosphor', 'tabler', 'iconpark']

export function isIconSetId(v: unknown): v is IconSetId {
  return typeof v === 'string' && (ICON_SET_IDS as readonly string[]).includes(v)
}
