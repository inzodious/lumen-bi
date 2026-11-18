/**
 * Power BI Desktop's built-in report themes (View ▸ Themes gallery), in gallery order.
 *
 * Sources (all public):
 *  - Color sequences: the "Built-in report themes" table of Microsoft Learn's "Use report themes in
 *    Power BI Desktop" article (one 8-color swatch image per theme; Jan 2024 revision, which still
 *    listed the full gallery incl. the Accessible themes). The images were sampled pixel by pixel.
 *    Where a text source exists it wins over the image (the images are anti-aliased renders and can be
 *    off by a few units per channel):
 *      · Executive: a theme exported from Power BI Desktop's built-in Executive theme (32 data colors,
 *        tableAccent, maximum/center/minimum) published in a public tutorial;
 *      · Tidal, Divergent: Microsoft's MIT-licensed PowerBI-Embedded-Showcases themes.js;
 *      · Classic, City park, Classroom, Colorblind safe, Electric, High contrast, Sunset, Twilight:
 *        DataVeld's 2018 hex reference (matches the images exactly).
 *  - Remaining approximations (documented on purpose — "never silently wrong"):
 *      · Image-sampled palettes (Highrise, Frontier, Innovate, Bloom, Temperature, Solar, Storm and the
 *        five Accessible themes) may differ from PBI's exact hex by a few units per channel.
 *      · PBI's built-in theme files carry 32+ data colors; only the first 8 are published (Executive and
 *        Classic excepted), so these themes cycle through 8 colors.
 *      · Sentiment (good/neutral/bad) and divergent (maximum/center/minimum) colors are not published
 *        for most themes: they are left unset so the base theme's values apply, instead of guessing.
 *        tableAccent defaults to the first data color (what PBI's exported built-ins use).
 *  "Default" means "no custom theme" (the CY24SU10 base theme applies), so its json is null.
 */

import { BUILTIN_THEMES as CORE_BUILTIN_THEMES } from '@core/report/themes/builtin'

export interface ThemeJson {
  name: string
  dataColors: string[]
  background?: string
  backgroundLight?: string
  backgroundNeutral?: string
  foreground?: string
  foregroundNeutralSecondary?: string
  foregroundNeutralTertiary?: string
  tableAccent?: string
  good?: string
  neutral?: string
  bad?: string
  maximum?: string
  center?: string
  minimum?: string
  null?: string
  hyperlink?: string
  visitedHyperlink?: string
  textClasses?: Record<string, { fontSize?: number; fontFace?: string; color?: string }>
  visualStyles?: Record<string, any>
  [k: string]: any
}

/** CY24SU10 base palette (first 8) — what "Default" shows in the gallery. */
export const DEFAULT_PALETTE = ['#118DFF', '#12239E', '#E66C37', '#6B007B', '#E044A7', '#744EC2', '#D9B300', '#D64550']

/** Legacy names resolvable by name from report files but not shown in PBI Desktop's gallery. */
const NOT_IN_GALLERY = new Set(['Concourse'])

/**
 * Gallery entries. Palettes live in the core module (`@core/report/themes/builtin`, single source of truth used by
 * theme resolution for reports that reference a built-in theme by name); this side only adds gallery metadata.
 */
export const BUILTIN_THEME_JSON: Array<{ name: string; json: ThemeJson | null; preview: string[]; previewBackground?: string; previewForeground?: string }> = [
  { name: 'Default', json: null, preview: DEFAULT_PALETTE },
  ...CORE_BUILTIN_THEMES.filter((t) => !NOT_IN_GALLERY.has(t.name)).map((t) => {
    const json = structuredClone(t) as ThemeJson
    return { name: json.name, json, preview: json.dataColors.slice(0, 8), previewBackground: json.background, previewForeground: json.foreground }
  })
]
