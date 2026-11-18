/**
 * Power BI's built-in report themes, resolvable by name. Reports (mostly legacy PBIX layouts) can reference a built-in
 * theme by name only (e.g. `themeCollection.customTheme = { name: "Concourse" }`) without embedding its JSON; Power BI
 * Desktop ships these themes, so we do too. Palettes are the same as the View ▸ Themes gallery
 * (renderer app/themes/builtin.ts documents the public sources and which values are image-sampled approximations).
 *
 * Legacy names: "Concourse" (a 2016-era built-in) is not documented publicly; reports using it render with the
 * classic teal/gray palette in Power BI, so it maps to the Classic colors (approximation, documented here).
 */

import { DEFAULT_BASE_THEME } from '../theme'
import { cloneDeep } from '../../clone'

export interface BuiltinThemeJson {
  name: string
  dataColors: string[]
  tableAccent?: string
  maximum?: string
  center?: string
  minimum?: string
  [k: string]: unknown
}

function theme(name: string, dataColors: string[], spec: Omit<BuiltinThemeJson, 'name' | 'dataColors'> = {}): BuiltinThemeJson {
  return { name, dataColors, tableAccent: dataColors[0], ...spec }
}

const CLASSIC = ['#01B8AA', '#374649', '#FD625E', '#F2C80F', '#5F6B6D', '#8AD4EB', '#FE9666', '#A66999', '#3599B8', '#DFBFBF', '#4AC5BB', '#5F6B6D', '#FB8281', '#F4D25A', '#7F898A', '#A4DDEE', '#FDAB89', '#B687AC', '#28738A', '#A78F8F']

export const BUILTIN_THEMES: BuiltinThemeJson[] = [
  theme('Highrise', ['#499195', '#00ACFC', '#C4B07B', '#F18F49', '#326633', '#F1C716', '#D8D7BF', '#224624']),
  theme(
      'Executive',
    [
      '#3257A8', '#37A794', '#8B3D88', '#DD6B7F', '#6B91C9', '#F5C869', '#77C4A8', '#DEA6CF',
      '#597CF4', '#4AC5BB', '#BA4AC5', '#C54A53', '#4A53C5', '#FEE266', '#3E9B80', '#C54A91',
      '#2545B5', '#05A595', '#801689', '#89161E', '#161F89', '#BDA750', '#047257', '#891658',
      '#182D79', '#0F5C55', '#540F5C', '#5C0F15', '#0F155C', '#7E6F36', '#074B3F', '#5C0F3C'
    ],
    { tableAccent: '#3257A8', maximum: '#3257A8', center: '#DD6B7F', minimum: '#D1DBF1' }
  ),
  theme('Frontier', ['#426871', '#D2B04C', '#A3623A', '#C25A3D', '#C39B6A', '#016E51', '#BEBBB7', '#FFA500']),
  theme('Innovate', ['#70B0E0', '#FCB714', '#2878BD', '#0EB194', '#108372', '#AF916D', '#C4B07B', '#F15628']),
  theme('Bloom', ['#8250C4', '#5ECBC8', '#438FFF', '#FF977E', '#EB5757', '#5B2071', '#EC5A96', '#A43B76']),
  theme('Tidal', ['#094782', '#0B72D7', '#098BF5', '#54B5FB', '#71C0A7', '#57B956', '#478F48', '#326633']),
  theme('Temperature', ['#262A76', '#234990', '#2F8AC3', '#26B0D2', '#FFC1CB', '#EB5559', '#AD3232', '#8E1F20']),
  theme('Solar', ['#FFAC00', '#E87200', '#E13102', '#D3004C', '#EF008C', '#9B0065', '#7D0033', '#5C0001']),
  theme('Divergent', ['#B73A3A', '#EC5656', '#F28A90', '#F8BCBD', '#99E472', '#23C26F', '#0AAC00', '#026645']),
  theme('Storm', ['#8BC7F7', '#46B3F3', '#009FEF', '#008CEE', '#0076EE', '#0050EB', '#0641C8', '#0B31A5']),
  // the pre-2019 default palette (20 colors were published for it)
  theme('Classic', CLASSIC),
  theme('City park', ['#73B761', '#4A588A', '#ECC846', '#CD4C46', '#71AFE2', '#8D6FD1', '#EE9E64', '#95DABB']),
  theme('Classroom', ['#4A8DDC', '#4C5D8A', '#F3C911', '#DC5B57', '#33AE81', '#95C8F0', '#DD915F', '#9A64A0']),
  theme('Colorblind safe', ['#074650', '#009292', '#FE6DB6', '#FEB5DA', '#480091', '#B66DFF', '#B5DAFE', '#6DB6FF']),
  theme('Electric', ['#118DFF', '#750985', '#C83D95', '#FF985E', '#1DD5EE', '#42F7C0', '#3049AD', '#F64F5C']),
  theme('High contrast', ['#107C10', '#002050', '#A80000', '#5C2D91', '#004B50', '#0078D7', '#D83B01', '#B4009E']),
  theme('Sunset', ['#B6B0FF', '#3049AD', '#FF994E', '#C83D95', '#FFBBED', '#42F9F9', '#00B2D9', '#FFD86C']),
  theme('Twilight', ['#F17925', '#004753', '#CCAA14', '#4B4C4E', '#D82C20', '#A3D0D4', '#536F18', '#46ABB0']),
  theme('Accessible default', ['#118DFF', '#12239E', '#E66C37', '#6B007B', '#E645AB', '#4A2D75', '#1AAB40', '#10433F']),
  theme('Accessible city park', ['#59A33A', '#2D386D', '#AD8F21', '#7B1C25', '#5C97D2', '#661F89', '#E56E1D', '#14482C']),
  theme('Accessible tidal', ['#0F3D6E', '#1F84FF', '#19423F', '#59A472', '#0F3A69', '#0E94FF', '#0B2623', '#59A472']),
  theme('Accessible neutral', ['#6B797C', '#362B2B', '#B08D72', '#40484A', '#86989C', '#5B3D35', '#928F8B', '#242828']),
  theme('Accessible orchid', ['#364B59', '#C480A7', '#663466', '#6E98B5', '#67002E', '#5D8099', '#3F213F', '#EC64A9']),
  theme('Concourse', CLASSIC)
]

const ALIASES: Record<string, string> = {
  citypark: 'City park',
  'city park': 'City park',
  highcontrast: 'High contrast',
  colorblindsafe: 'Colorblind safe',
  'colorblind safe-longer': 'Colorblind safe',
  accessibledefault: 'Accessible default',
  accessiblecitypark: 'Accessible city park',
  accessibletidal: 'Accessible tidal',
  accessibleneutral: 'Accessible neutral',
  accessibleorchid: 'Accessible orchid'
}

/** Built-in theme JSON by name ("Concourse", "Executive", "City park", "CityPark.json"...), or undefined. */
export function builtinTheme(name: string | undefined | null): BuiltinThemeJson | undefined {
  if (!name) return undefined
  const key = name.replace(/\.json$/i, '').trim().toLowerCase()
  const target = (ALIASES[key] ?? ALIASES[key.replace(/[\s_-]+/g, '')] ?? key).toLowerCase()
  const hit = BUILTIN_THEMES.find((t) => t.name.toLowerCase() === target || t.name.toLowerCase().replace(/\s+/g, '') === target.replace(/[\s_-]+/g, ''))
  return hit ? cloneDeep(hit) : undefined
}

/**
 * Base theme for legacy reports (PBIX Layout format) that carry no themeCollection: Power BI renders them with the
 * pre-2019 default palette (Classic). Only the palette and table accent are the legacy values; text classes and
 * visual styles come from the current base theme (legacy layouts store most formatting explicitly on the visuals).
 */
export function legacyDefaultBaseTheme(): any {
  const base = cloneDeep(DEFAULT_BASE_THEME)
  // Pre-2019 visuals had axis titles off by default; the current base theme turns them on for every chart via
  // visualStyles['*']['*'].categoryAxis/valueAxis.showAxisTitle. Legacy layouts that want titles save them explicitly.
  const all = base.visualStyles?.['*']?.['*']
  for (const axis of ['categoryAxis', 'valueAxis']) {
    const bag = all?.[axis]?.[0]
    if (bag) bag.showAxisTitle = false
  }
  // Title wrapping arrived in 2020; legacy titles render on one line (truncated with an ellipsis when too long).
  const titleBag = all?.title?.[0]
  if (titleBag) titleBag.titleWrap = false
  return { ...base, name: 'Classic', dataColors: [...CLASSIC], tableAccent: CLASSIC[0] }
}
