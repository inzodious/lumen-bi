/**
 * Built-in icons — shared types (pure TS: no DOM, no React, no Node).
 *
 * The icons themselves are React components of icon libraries (renderer/src/icons/registry.ts); this side only knows
 * how an icon is referenced and stored: `{ set, name, color?, strokeWidth?, padding? }` (IconRef).
 */

/** Sets offered by Lumen (see sets.ts). Adding one: docs/ICONS.md "Adding a set". */
export type IconSetId = 'lucide' | 'fluent-color'

/**
 * Sets that earlier Lumen builds offered and that are gone. A saved reference to one of them is dropped on open
 * (its picture stays, as a plain image): see bake.ts pruneStaleIcons.
 */
export const REMOVED_ICON_SET_IDS: readonly string[] = ['fluent', 'phosphor', 'ph', 'tabler', 'iconpark']

/**
 * A colour as stored in an icon reference: a literal `#RRGGBB`, or a report theme colour
 * `theme:<ColorId>` / `theme:<ColorId>:<percent>` (ColorId as in PBIR ThemeDataColor: 0 = background,
 * 1 = foreground, 2.. = data colours; percent in [-1, 1] tints / shades like Power BI's theme swatches).
 */
export type IconColor = string

export interface IconRef {
  set: IconSetId
  /** icon name inside the set: kebab-case of the component name without the library prefix (`LuChartBar` → `chart-bar`) */
  name: string
  /** single-colour sets: the glyph colour (missing = the set's default) */
  color?: IconColor
  /** sets with strokes: stroke width in the artwork's own units (missing = the set's default) */
  strokeWidth?: number
  /** empty space around the glyph, % of the icon box (0–40) */
  padding?: number
}

export const ICON_SET_IDS: readonly IconSetId[] = ['lucide', 'fluent-color']

export function isIconSetId(v: unknown): v is IconSetId {
  return typeof v === 'string' && (ICON_SET_IDS as readonly string[]).includes(v)
}
