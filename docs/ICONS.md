# Built-in icons

Lumen lets you put an icon on a report without Power BI's workarounds (an image file per icon, an SVG data URI built
in a DAX measure, a web URL): pick it, colour it, and it renders, exports, saves and reopens, including in Power BI
Desktop, which sees an ordinary image.

The icons are **the React components of icon libraries**, rendered natively on the canvas, in the picker, in the
Format pane and in exports. Lumen never assembles icon SVG from path data.

## Sets

| Set | Components | Licence | Icons | Controls |
|---|---|---|---|---|
| **Lucide** | `react-icons/lu` (react-icons 5.7.0) | ISC (Feather-derived parts MIT); react-icons MIT | 1,541 | colour (theme colour or hex), stroke width 0.5 – 3, padding |
| **Fluent Color** | the unsized `*Color` components of `@fluentui/react-icons` (2.0.346, 20 px grid) | MIT | 196 | none (fixed artwork), padding |

The plain Fluent regular / filled icons are Lumen's own UI icons, not an icon-picker set. A new Lucide icon is drawn in
the theme foreground (theme colour 1, "Black" in the swatches), so it follows a theme change. Fluent marks its
`*Color` components as deprecated in favour of a future colour API; they are still shipped and unchanged.

**Business & dashboards** is a curated category in both sets (charts, KPIs and targets, trends, money, people and
organisations, calendar and time, documents and reports, communication, status and alerts, filters and settings,
data and databases, places and logistics: 409 Lucide and 134 Fluent Color icons). It is computed from the icon names
(whole-token keyword matches, some anchored at the start of the name) with per-group exclusions — reviewed keyword
lists in `src/core/icons/curated.ts`, not a list of names. Search matches name tokens, token prefixes and a small
synonym table (`SYNONYMS` in `src/core/icons/search.ts`; the libraries ship no tags).

## Code

| Where | What |
|---|---|
| `src/core/icons/types.ts`, `sets.ts` | `IconRef` `{ set, name, color?, strokeWidth?, padding? }`; set metadata (labels, licences, which controls apply); removed set ids |
| `src/core/icons/ref.ts` | parse / serialise references, colours (`#RRGGBB` or `theme:<ColorId>[:<percent>]`), theme resolution, component name → icon name |
| `src/core/icons/curated.ts`, `search.ts` | Business & dashboards, search (pure, over names) |
| `src/core/icons/bake.ts` | storing a picture in PBIR, the `Lumen_Icon` annotation, fingerprints, stale / removed-set references, re-bake |
| `src/renderer/src/icons/registry.ts` | the sets as lazily imported component modules; names (`LuChartColumn` → `chart-column`) |
| `src/renderer/src/icons/sets/fluentColor.generated.ts` | barrel of the Fluent `*Color` components (`node scripts/icons/gen-fluent-color.mjs`) |
| `src/renderer/src/icons/IconGlyph.tsx` | the element tree of an icon (canvas, picker, Format pane) |
| `src/renderer/src/icons/picture.ts` | the picture copy saved for Power BI |
| `src/renderer/src/icons/IconPicker.tsx`, `IconSourceRows.tsx`, `actions.ts` | `openIconPicker()`, Format pane rows, document edits and re-bakes |

Theme colours are PBIR `ThemeDataColor` ids (0 background, 1 foreground, 2.. data colours; percent tints / shades like
the theme swatches).

### How an icon is drawn

`iconSvgElement` (IconGlyph.tsx) returns an outer `<svg viewBox="0 0 256 256">` that only positions (padding, image fit
via `preserveAspectRatio`) with the library component nested in it:

* react-icons: `size` (width / height), `color` (the component puts it in its root `style`, the artwork strokes in
  `currentColor`), `strokeWidth` (passed through to the root and inherited by the strokes).
* Fluent: the root is always `width="1em"`, so the box is set with `fontSize`; `idPrefix` scopes its gradient, clip
  and filter ids. Fluent does **not** make them unique by itself: two copies of the same colour icon on a page would
  share ids (and an icon in a hidden element would break the visible one's gradients). Every canvas / picker instance
  gets a `useId`-based prefix; the saved picture uses `lumen-`. Every shape of every Fluent Color icon has its own fill
  (tested), so they look the same on dark backgrounds.

## Lazy loading

Each set is a separate chunk imported by `loadIconSet()` when the picker shows the set, when a canvas visual draws one
of its icons, and for the sets a report uses right after it is opened (so theme re-bakes inside an edit are
synchronous). Loading a set also loads `react-dom/server` (its own chunk), which renders the picture copy. While a set
loads the app counts as busy (`readiness`), so captures and exports wait. Built renderer, measured against the build
before this change: initial JS (entry + modulepreloads) 7.78 MB (was 7.80 MB), chunks `lu` 1.08 MB,
`fluentColor.generated` 0.60 MB, `server.browser` 0.46 MB (unminified), total output 15.9 MB (was 26.5 MB with the
Iconify data).

## How an icon is saved

Power BI knows nothing about Lumen, so every icon is **baked**: a picture of it is stored the way Power BI stores that
visual's image, and Lumen keeps the editable reference beside it. The picture is the component's own output
(`renderToStaticMarkup` of `iconSvgElement` in the renderer: a standalone SVG document with `xmlns`, 256 px intrinsic
size, colours resolved to hex through the report theme, ids prefixed, no external references); `core/icons/bake.ts`
only stores the string.

* **Image visual**: a registered resource, like an uploaded image (the form of every image visual in Microsoft's
  sample reports and of Lumen's Insert ▸ Image):
  `StaticResources/RegisteredResources/LumenIcon_<set>_<name>_<hash>.svg`, listed in `report.json`
  `resourcePackages[RegisteredResources]` with `type: "Image"`, referenced by
  `visual.objects.general[0].properties.imageUrl = { expr: { ResourcePackageItem } }` (a visual already using the
  newer `objects.image[0].properties.sourceFile` shape keeps it). Image fit stays `imageScaling.imageScalingType`.
* **New card** callout image (`image`) and card image (`cardImage`): those slots take a URL or a data-bound value,
  not an uploaded resource, so the SVG is a data URI in the URL property:
  `imageType: 'imageUrl'`, `imageUrl: 'data:image/svg+xml;base64,…'`, `show` on. Position, size and alignment settings
  are untouched. The icon goes into the entry the card reads (and a Format pane edit of the same card writes):
  current Power BI stores the card's settings under `selector: { id: 'default' }`, which is the same entry as no
  selector (`core/report/entries.ts`). A data-bound source in that entry (`imageData` from "Select from data", or a
  measure-bound `imageUrl`) is removed so nothing can prefer it over the icon; what the slot held before
  (`imageType`, `imageUrl`, `imageData`) is kept in the binding's `restore` and written back when the icon is removed
  or the Image source is switched back (also after save and reopen). Icons that the first build put into a stray
  selector-less entry behind a `{ id: 'default' }` one (where the card never showed them) are moved onto the right
  entry on open.
* **The reference**: the visual's `annotations` (visualContainer schema: `[{ name, value: string }]`, preserved and
  ignored by Power BI), name `Lumen_Icon`:

```json
"annotations": [{
  "name": "Lumen_Icon",
  "value": "{\"version\":2,\"icons\":[{\"slot\":{\"object\":\"general\",\"property\":\"imageUrl\",\"form\":\"resource\"},\"icon\":{\"set\":\"lucide\",\"name\":\"trending-up\",\"color\":\"theme:4\",\"strokeWidth\":1.5},\"bake\":\"dbf6565bef73a1c2\",\"resource\":\"LumenIcon_lucide_trending-up_dbf6565bef73.svg\"}]}"
}]
```

`bake` is a fingerprint of the stored bytes (resource) or of the data URI string. A slot's `selector` is the logical
one (none, or a series `metadata`); `id: 'default'` is ignored when slots are compared. Card bindings also carry
`restore` (raw PBIR values of the slot's source properties before the icon, `null` = absent).

* **On open** a binding whose slot no longer holds what was baked (the picture was replaced in Power BI, or by an
  image edit in Lumen) is stale: the image wins and the binding is dropped. A binding to a set Lumen no longer offers
  (`fluent`, `phosphor`, `tabler`, `iconpark` from an earlier build) is dropped too and its picture stays as a plain
  image. Both are reported as info diagnostics (`pruneStaleIcons`, `core/io/open.ts`).
* **Re-bake** happens on every icon edit, inside the same undo step when the report theme changes
  (`onReportThemeChange` in `state/store.ts`; icons with literal colours and Fluent Color icons are left alone), and
  before every save. Old baked resources are deleted once nothing references them (only `LumenIcon_` items are ever
  deleted).
* **Canvas and exports**: the image visual draws the component inline (never the file content: an annotation in a file
  cannot inject markup), the card draws its data URI with `<img>`. Both stay vector in PDF export; PNG / PowerPoint /
  HTML exports are page captures and show them like any visual.
* **PBIX**: Lumen does not write `.pbix` (Save of a PBIX offers PBIP or `.wbi`), so icons are saved through PBIP or
  the `.wbi` bundle (PBIP + data), never into a PBIX.

What is verified: the round trip in Lumen (unit tests and the `e2e/icons.e2e.ts` journey: save PBIP, reopen, edit),
and that saved `visual.json` files with an icon (image visual with a Lucide and with a Fluent Color icon, card with a
callout icon) validate against Microsoft's published visualContainer 2.4.0 schema and the schemas it references
(visualConfiguration 2.2.0, formattingObjectDefinitions 1.4.0, semanticQuery 1.3.0, filterConfiguration 1.2.0).
What is assumed (no Power BI Desktop on Linux): that Power BI shows an SVG registered resource in the image visual (it
accepts SVG uploads there) and an SVG data URI as the new card's image URL. The pictures were checked in Chromium only
(canvas, card `<img>`, PDF); the Fluent pictures size their nested root with `font-size` + `1em`, which browsers
support; other SVG renderers were not tried.

## Adding a set

A react-icons set (e.g. Tabler, `react-icons/tb`) is a few lines:

1. its id in `IconSetId` / `ICON_SET_IDS` (`core/icons/types.ts`) and its metadata in `ICON_SETS`
   (`core/icons/sets.ts`: label, licence, `colorable`, `stroke`, grid);
2. its loader in `LOADERS` (`renderer/src/icons/registry.ts`):
   `tabler: { load: () => import('react-icons/tb'), prefix: 'Tb', kind: 'react-icons' }`;
3. its licence text in `resources/licenses/icons/` and a row in `THIRD_PARTY_NOTICES.md`; check the curated groups
   (`registry.test.ts` prints the counts) and look at samples of every group.

## Where the picker can plug in next

`openIconPicker({ initial })` returns an `IconRef`; `setVisualIcon` stores it in any image slot. Candidates: button
icons (`visuals/elements/ActionButton.tsx`, `buttonIcons.ts`: `icon.shapeType` → a custom image), shapes and page /
canvas backgrounds and wallpaper (Format pane `image` properties: `PropEditor.tsx` `pickImage`), the card's tile
background image (`fillCustom.imageUrl`), and table / matrix conditional-formatting icons
(`panes/visualizations/cf/*`, `visuals/common/conditionalFormatting.ts`: an icon rule could carry an SVG data URI like
a web URL icon).
