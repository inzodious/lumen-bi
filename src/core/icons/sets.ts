/**
 * The four built-in icon libraries: labels, licences, variants (weights / themes), colour slots and
 * how each variant maps the set's colour roles onto the user's colours. Pure data, no icon artwork
 * (that is loaded on demand, registry.ts).
 *
 * Colour roles per set (tokens {{n}} in the normalised bodies, normalize.ts):
 *   fluent, phosphor, tabler  {{0}} = the glyph colour (Iconify `currentColor`);
 *                              phosphor duotone {{1}} = the 20 % opacity back layer
 *   iconpark                  {{0}} outer stroke · {{1}} outer fill · {{2}} inner stroke · {{3}} inner fill
 *                              (IconPark's own four theme colours; its themes are fixed mappings of them:
 *                              outline [c, none, c, none], filled [c, c, #FFF, #FFF], two-tone [c, c2, c, c2],
 *                              multi-color [stroke, fill, innerStroke, innerFill])
 */
import type { IconSetId, IconSetSpec, VariantSpec } from './types'

const PRIMARY = 'theme:2'
const FOREGROUND = 'theme:1'
const one = (id: string, label: string, extra: Partial<VariantSpec> = {}): VariantSpec => ({ id, label, slots: [{ label: 'Color', default: PRIMARY }], roles: [0], ...extra })

export const ICON_SETS: Record<IconSetId, IconSetSpec> = {
  fluent: {
    id: 'fluent',
    label: 'Fluent UI',
    license: 'MIT',
    author: 'Microsoft Corporation',
    url: 'https://github.com/microsoft/fluentui-system-icons',
    variants: [one('regular', 'Regular'), one('filled', 'Filled'), { id: 'color', label: 'Color', slots: [], roles: [] }],
    defaultVariant: 'regular'
  },
  phosphor: {
    id: 'phosphor',
    label: 'Phosphor',
    license: 'MIT',
    author: 'Phosphor Icons',
    url: 'https://github.com/phosphor-icons/core',
    variants: [
      one('thin', 'Thin'),
      one('light', 'Light'),
      one('regular', 'Regular'),
      one('bold', 'Bold'),
      one('fill', 'Fill'),
      {
        id: 'duotone',
        label: 'Duotone',
        // Phosphor draws the back layer in the glyph colour at 20 % opacity; here it is its own colour,
        // by default the glyph colour tinted 80 % toward white (the same look on a white background)
        slots: [
          { label: 'Color', default: PRIMARY },
          { label: 'Secondary', default: { derive: 0, percent: 0.8 } }
        ],
        roles: [0, 1]
      }
    ],
    defaultVariant: 'regular'
  },
  tabler: {
    id: 'tabler',
    label: 'Tabler',
    license: 'MIT',
    author: 'Paweł Kuna',
    url: 'https://github.com/tabler/tabler-icons',
    variants: [one('outline', 'Outline', { stroke: { default: 2, min: 0.5, max: 3, step: 0.25 } }), one('filled', 'Filled')],
    defaultVariant: 'outline'
  },
  iconpark: {
    id: 'iconpark',
    label: 'IconPark',
    license: 'Apache-2.0',
    author: 'ByteDance',
    url: 'https://github.com/bytedance/IconPark',
    variants: [
      { id: 'outline', label: 'Outline', slots: [{ label: 'Color', default: PRIMARY }], roles: [0, 'none', 0, 'none'], stroke: { default: 4, min: 1, max: 8, step: 0.5 }, sharedBody: true },
      { id: 'filled', label: 'Filled', slots: [{ label: 'Color', default: PRIMARY }], roles: [0, 0, '#FFFFFF', '#FFFFFF'], stroke: { default: 4, min: 1, max: 8, step: 0.5 }, sharedBody: true },
      {
        id: 'two-tone',
        label: 'Two-tone',
        slots: [
          { label: 'Line', default: FOREGROUND },
          { label: 'Fill', default: PRIMARY }
        ],
        roles: [0, 1, 0, 1],
        stroke: { default: 4, min: 1, max: 8, step: 0.5 },
        sharedBody: true
      },
      {
        // the tri-colour option: IconPark "multi-color" with three user colours; the inner stroke (details
        // drawn over the fill) stays white like IconPark's default
        id: 'multi-color',
        label: 'Tri-color',
        slots: [
          { label: 'Primary (fill)', default: PRIMARY },
          { label: 'Secondary (accent)', default: { derive: 0, percent: 0.6 } },
          { label: 'Line', default: FOREGROUND }
        ],
        roles: [2, 0, '#FFFFFF', 1],
        stroke: { default: 4, min: 1, max: 8, step: 0.5 },
        sharedBody: true
      }
    ],
    defaultVariant: 'multi-color'
  }
}

export function variantSpec(set: IconSetId, variant: string): VariantSpec | undefined {
  return ICON_SETS[set]?.variants.find((v) => v.id === variant)
}
