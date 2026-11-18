# Built-in icons

Lumen ships four icon libraries and lets you put an icon on a report without Power BI's workarounds (an image file
per icon, an SVG data URI built in a DAX measure, a web URL): pick it, colour it, and it renders, exports, saves and
reopens, including in Power BI Desktop, which sees an ordinary image.

## Sets and variants

| Set | Source (npm) | Licence | Variants | Colours | Stroke |
|---|---|---|---|---|---|
| Fluent UI System Icons | `@iconify-json/fluent`, `@iconify-json/fluent-color` | MIT | Regular, Filled, Color | 1 (Color: the icon's own gradients) | no |
| Phosphor | `@iconify-json/ph` | MIT | Thin, Light, Regular, Bold, Fill, Duotone | 1 (Duotone: 2) | weights are variants |
| Tabler | `@iconify-json/tabler` | MIT | Outline, Filled | 1 | Outline: 0.5 – 3 |
| IconPark | `@iconify-json/icon-park` | Apache-2.0 | Outline, Filled, Two-tone, **Tri-color** | 1 / 1 / 2 / 3 | 1 – 8 (48 px grid) |

The artwork is each library's own SVG set as packaged by Iconify (pure data, usable from `src/core`, no React
dependency). Fluent's Color icons are the same artwork `@fluentui/react-icons` ships as `*Color` components.

**Tri-color (IconPark multi-color).** IconPark draws every icon with four colour roles: outer stroke, outer fill,
inner stroke, inner fill. Its themes are fixed mappings of them (outline `[c, none, c, none]`, filled
`[c, c, #FFF, #FFF]`, two-tone `[c, c2, c, c2]`). Lumen's Tri-color exposes three user colours —
*Primary (fill)* → outer fill, *Secondary (accent)* → inner fill, *Line* → outer stroke — and keeps the inner stroke
(details drawn over the fill) white like IconPark's default. Defaults: data colour 1 of the theme, the same tinted
60 % toward white (follows Primary until set), and the theme foreground.

**Business & dashboards** is a curated category across all four sets (charts, KPIs and targets, trends, money,
people and organisations, calendar and time, documents and reports, communication, status and alerts, filters and
settings, data and databases). It is computed from icon names (whole-token keyword matches, a few anchored at the
start of the name) and IconPark's own categories, with per-group exclusions — reviewed keyword lists in
`src/core/icons/curated.ts`, not a list of names. Search matches name tokens, token prefixes, IconPark categories and a
small synonym table (`SYNONYMS` in `registry.ts`; Iconify data carries no tags).

## Code

| Where | What |
|---|---|
| `src/core/icons/types.ts` | `IconRef` `{ set, name, variant, colors?, strokeWidth?, padding? }`, `IconSetData` |
| `src/core/icons/sets.ts` | the four sets: labels, licences, variants, colour slots and their role mapping |
| `src/core/icons/ref.ts` | parse / serialise references, colour values, theme resolution |
| `src/core/icons/svg.ts` | SVG strings from set data (colour roles, stroke, padding, id namespacing) |
| `src/core/icons/registry.ts` | lazy set loading, listing, search, set categories |
| `src/core/icons/curated.ts` | Business & dashboards |
| `src/core/icons/normalize.ts` | Iconify JSON → `IconSetData` (build time) |
| `src/core/icons/bake.ts` | storing icons in PBIR (below) |
| `scripts/icons/icon-data-plugin.ts` | Vite plugin: `virtual:lumen-icons/<set>` modules (renderer build and vitest) |
| `src/renderer/src/icons/` | `IconGlyph` (React element), `IconPicker` (`openIconPicker()`), Format pane rows, document actions |

Colours are `#RRGGBB` or theme colours `theme:<ColorId>[:<percent>]` (PBIR `ThemeDataColor`: 0 background,
1 foreground, 2.. data colours; percent tints / shades like the theme swatches), so an icon follows a theme change.

## Lazy loading

Each set's artwork is a separate chunk (`fluent` ≈ 4.3 MB, `phosphor` ≈ 4.4 MB, `tabler` ≈ 2.4 MB, `iconpark`
≈ 1.8 MB of JS that is one `JSON.parse` of a string) imported on demand by `loadIconSet()`: when the picker shows a
set, when a canvas visual draws an icon of it, and for the sets used by a report right after it is opened (so theme
re-bakes inside an edit are synchronous). While a set loads the app counts as busy (`readiness`), so captures and
exports wait for it. Nothing of the artwork is in the initial renderer bundle; the picker grid is virtualised
(`@tanstack/react-virtual`). Fluent is normalised to one size per icon at build time (the raw package has seven).

## How an icon is saved

Power BI knows nothing about Lumen, so every icon is **baked** to an SVG and stored the way Power BI stores that
visual's image; Lumen keeps the editable reference beside it.

* **Image visual**: a registered resource, like an uploaded image (the form of every image visual in Microsoft's
  sample reports and of Lumen's Insert ▸ Image):
  `StaticResources/RegisteredResources/LumenIcon_<set>_<name>_<hash>.svg`, listed in `report.json`
  `resourcePackages[RegisteredResources]` with `type: "Image"`, referenced by
  `visual.objects.general[0].properties.imageUrl = { expr: { ResourcePackageItem } }` (a visual already using the
  newer `objects.image[0].properties.sourceFile` shape keeps it). Image fit stays `imageScaling.imageScalingType`.
* **New card** callout image (`image`) and card image (`cardImage`): those slots take a URL or a data-bound value,
  not an uploaded resource, so the SVG is a data URI in the URL property:
  `imageType: 'imageUrl'`, `imageUrl: 'data:image/svg+xml;base64,…'`. Position, size and alignment settings are untouched.
* **The reference**: the visual's `annotations` (visualContainer schema: `[{ name, value: string }]`, preserved and
  ignored by Power BI), name `Lumen_Icon`:

```json
"annotations": [{
  "name": "Lumen_Icon",
  "value": "{\"version\":1,\"icons\":[{\"slot\":{\"object\":\"general\",\"property\":\"imageUrl\",\"form\":\"resource\"},\"icon\":{\"set\":\"iconpark\",\"name\":\"wallet\",\"variant\":\"multi-color\",\"colors\":[\"theme:4\",null,\"theme:1\"]},\"bake\":\"17a2c886106c4f0b\",\"resource\":\"LumenIcon_iconpark_wallet_17a2c886106c.svg\"}]}"
}]
```

`bake` is a fingerprint of the baked bytes (resource) or of the data URI string.

* **On open** a binding whose slot no longer holds what was baked (the picture was replaced in Power BI, or by an
  image edit in Lumen) is stale: the image wins and the binding is dropped (`pruneStaleIcons`, `core/io/open.ts`).
* **Re-bake** happens on every icon edit, inside the same undo step when the report theme changes
  (`onReportThemeChange` in `state/store.ts`; icons with literal colours are left alone), and before every save.
  Old baked resources are deleted once nothing references them (only `LumenIcon_` items are ever deleted).
* **Canvas and exports**: the image visual draws the icon as inline SVG generated from the library data (never from
  file content: an annotation in a file cannot inject markup), the card draws its data URI with `<img>`. Both stay
  vector in PDF export; PNG / PowerPoint / HTML exports are page captures and show them like any visual.
* **PBIX**: Lumen does not write `.pbix` (Save of a PBIX offers PBIP or `.wbi`), so icons are saved through PBIP or
  the `.wbi` bundle (PBIP + data), never into a PBIX.

What is verified: the round trip in Lumen (unit tests and the `e2e/icons.e2e.ts` journey: save PBIP, reopen, edit),
and that saved `visual.json` files with an icon validate against Microsoft's published visualContainer 2.4.0 schema
and the schemas it references. What is assumed (no Power BI Desktop on Linux): that Power BI shows an SVG registered
resource in the image visual (it accepts SVG uploads there) and an SVG data URI as the new card's image URL.

## Adding a set

1. Add the Iconify JSON package and its id to `ICONIFY_PACKAGES` (`normalize.ts`), with a normaliser that groups
   names into icons and variants and replaces colours by role tokens `{{n}}` and stroke widths by `{{w:X}}`.
2. Describe it in `ICON_SETS` (`sets.ts`): variants, colour slots, role mapping, stroke range.
3. Add the loader in `registry.ts` (`virtual:lumen-icons/<id>`), the id to `IconSetId`, the licence text to
   `resources/licenses/icons/` and a row to `THIRD_PARTY_NOTICES.md`; extend the tests in `src/core/icons/__tests__`.

## Where the picker can plug in next

`openIconPicker({ initial })` returns an `IconRef`; `bakeIcon` stores it in any image slot. Candidates: button icons
(`visuals/elements/ActionButton.tsx`, `buttonIcons.ts`: `icon.shapeType` → a custom image), shapes and page / canvas
backgrounds and wallpaper (Format pane `image` properties: `PropEditor.tsx` `pickImage`), the card's tile background
image (`fillCustom.imageUrl`), and table / matrix conditional-formatting icons (`panes/visualizations/cf/*`,
`visuals/common/conditionalFormatting.ts`: an icon rule could carry an SVG data URI like a web URL icon).
