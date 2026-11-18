/**
 * The built-in icon sets: what Lumen needs to know about each one without loading it (labels, licences, which
 * controls apply). The artwork is the library's own React components, loaded on demand by the renderer
 * (renderer/src/icons/registry.ts holds the matching loader for every id here).
 *
 *   lucide        react-icons/lu — single colour line icons on a 24 px grid (colour + stroke width)
 *   fluent-color  the `*Color` components of @fluentui/react-icons — fixed multi-colour artwork (no colour controls)
 */
import type { IconColor, IconSetId } from './types'

export interface IconSetSpec {
  id: IconSetId
  label: string
  /** npm package (and module) the components come from */
  library: string
  /** the artwork's licence (the npm wrapper's licence is in THIRD_PARTY_NOTICES.md) */
  license: string
  author: string
  url: string
  /** single-colour artwork: the user picks its colour (default `defaultColor`) */
  colorable: boolean
  defaultColor?: IconColor
  /** adjustable stroke width (artwork units) */
  stroke?: { default: number; min: number; max: number; step: number }
  /** the artwork's own grid (viewBox) size */
  grid: number
}

/**
 * Default colour of a new single-colour icon: the theme foreground (theme colour 1, "Black" in the theme swatches;
 * #252423 in the default theme). Calmer than data colour 1 on a page full of icons and still follows a theme change.
 */
export const DEFAULT_ICON_COLOR: IconColor = 'theme:1'

export const ICON_SETS: Record<IconSetId, IconSetSpec> = {
  lucide: {
    id: 'lucide',
    label: 'Lucide',
    library: 'react-icons/lu',
    license: 'ISC',
    author: 'Lucide Contributors',
    url: 'https://lucide.dev',
    colorable: true,
    defaultColor: DEFAULT_ICON_COLOR,
    stroke: { default: 2, min: 0.5, max: 3, step: 0.25 },
    grid: 24
  },
  'fluent-color': {
    id: 'fluent-color',
    label: 'Fluent Color',
    library: '@fluentui/react-icons',
    license: 'MIT',
    author: 'Microsoft Corporation',
    url: 'https://github.com/microsoft/fluentui-system-icons',
    colorable: false,
    grid: 20
  }
}
