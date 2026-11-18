# Format pane internals

> **Applies to:** Developers

This article explains how the Format pane is built from visual definitions, where each control reads its value, where an edit is written, how the pane shows defaults it never stored, and how conditional formatting (fx) targets are addressed. Read it before you add a format card or property, or change how one is written.

## Overview

The Format pane is the **Format visual** tab of the Visualizations pane (`src/renderer/src/panes/visualizations/`). With one visual selected it shows a **Visual** and a **General** sub-tab; with nothing selected it formats the page.

| File | Role |
|---|---|
| `FormatTab.tsx` | The tab: builds the card list for the selected visual, or the page cards. Search box. |
| `containerCards.ts` | `CONTAINER_CARDS`: the General-tab cards every visual gets (Title, Effects, Header icons, Tooltips and so on); `ANALYTICS_OBJECTS`; `FONT_FAMILIES`. |
| `PropEditor.tsx` | `BagTarget`, `writeProp()`, `resetProps()`, `FormatCardView`, `PropRow`: one control per `FormatPropDef`. |
| `propModel.ts` | Pure display model: `propState()` (what a control shows) and `layoutProps()` (how a card's properties are arranged). |
| `objects.ts` | Pure helpers over PBIR objects bags: `findEntry`, `getRaw`, `setRaw`. |
| `effective.ts` | The renderer default of a property set nowhere (`rendererDefault()`). |
| `chartDefaults.ts` | Defaults of chart properties that depend on the theme or the visual's configuration. |
| `controls.tsx` | The spin box, percent slider, B / I / U group and alignment group. |
| `cf/*` | Conditional formatting: targets, the fx dialog, PBIR rule builders. |
| `AnalyticsTab.tsx` | The Analytics tab (reference lines, trend, forecast, error bars). |

## Which cards appear

`VisualFormat` in `FormatTab.tsx` splits the visual definition's `formatCards`:

```ts
const own = (def?.formatCards ?? []).filter((c) => !ANALYTICS_OBJECTS.has(c.object))
const visualCards = own.filter((c) => c.tab !== 'general' && !c.container)
const builtinObjects = new Set(CONTAINER_CARDS.map((c) => c.object))
const extraGeneral = own.filter((c) => (c.tab === 'general' || c.container) && !(c.container && builtinObjects.has(c.object)))
```

- **Visual tab**: the definition's own cards, plus table and matrix extras (`TableLayoutCard`, `LevelSubtotalsCard`, `CellElementsCard`).
- **General tab**: a **Properties** card (size, position, padding, advanced options), the built-in `CONTAINER_CARDS` grouped into top-level cards by their `group` (Title > Title / Subtitle / Divider / Spacing, Effects > Background / Visual border / Shadow, Header icons > Colors / Icons / Help tooltip, Tooltips > Options), and any definition card marked `tab: 'general'` or `container: true` whose object is not already built in.
- Cards whose object is in `ANALYTICS_OBJECTS` (reference lines, average / min / max / median / percentile lines, trend, forecast, error bars) go to the **Analytics** tab instead.

`layoutProps()` arranges a card's rows the way Power BI does: a font family followed by the size of the same text share one **Font** row, and adjacent Bold / Italic / Underline switches become one button group.

## Where a control reads and writes: `BagTarget`

Every card edits one **objects bag**: `visual.objects`, `visual.visualContainerObjects`, a page's `objects`, or the mobile layout's override objects. A `BagTarget` abstracts which one:

```ts
export interface BagTarget {
  bag: ObjectsBag | undefined
  locate(report: ReportDocument): ObjectsBag | undefined
  resolveRaw(object: string, prop: string, selector?: Selector): any
  defaults?(object: string, prop: string, def?: Pick<FormatPropDef, 'type' | 'options'>): Scalar | undefined
  theme: ResolvedTheme
  label: string
  cf?: CFContext
  beforeWrite?(report: ReportDocument, bag: ObjectsBag, object: string): void
}
```

(Doc comments removed; see `PropEditor.tsx`.) Factories: `visualTarget()` and `pageTarget()` in `FormatTab.tsx`, `mobileTarget()` in `report/mobile/format.ts`. `bag` is the current, read-only bag for display; `locate()` finds the same bag inside the draft report of an edit; `beforeWrite` lets the mobile target seed an override object from the desktop formatting before the first write.

### Reading: the effective value

`propState(def, object, target, selector)` in `propModel.ts` returns three things:

- `explicit`: the property is stored on this visual (or page) itself;
- `raw`: the resolved stored value, explicit then theme (`target.resolveRaw`, which is `rawProp()` from `core/report/props.ts`);
- `value`: what the control shows.

The order for `value` is: explicit value, theme `visualStyles`, the renderer's own default (`target.defaults`), the card definition's `default`, and finally nothing, which numeric and dropdown controls show as **Auto** and color pickers as the "no color" swatch. Power BI never shows an empty box for a property the visual draws with, and neither should Lumen.

### Writing: `writeProp`

```ts
export function writeProp(target: BagTarget, object: string, prop: string, raw: RawOrFn, selector?: Selector, coalesce?: string): void {
  useApp.getState().mutateReport(
    target.label,
    (r) => {
      const bag = target.locate(r)
      if (!bag) return
      target.beforeWrite?.(r, bag, object)
      setRaw(bag, object, prop, typeof raw === 'function' ? raw(r) : raw, selector)
      ...
    },
    coalesce ? { coalesce } : undefined
  )
}
```

Each edit is one `mutateReport` call, so one undo step; continuous edits (dragging a slider, holding a spin arrow) pass a `coalesce` key and merge into a single step. Clearing a numeric box or choosing reset writes `undefined`, which removes the property.

Values are wrapped as PBIR literals by `wrapFor()`: booleans as `true` / `false`, every number as a double literal (`3D`, whatever the control type), colors as `{ solid: { color: { expr: { Literal: { Value: "'#RRGGBB'" } } } } }` or a `ThemeDataColor` when a theme swatch is picked, everything else as a quoted string.

### Which entry receives the write

An objects bag holds, per object, an array of entries `{ properties, selector? }`. `setRaw()` delegates to `writeEntryProp()` in `src/core/report/entries.ts`, the single rule every writer shares (Format pane, conditional formatting, built-in icons, `setObjectProp`):

- `selector: { id: 'default' }` and no selector are the same group. Current Power BI writes `{ id: 'default' }` for the new card's and other new-format visuals' general formatting; older reports and Lumen leave the selector out; every reader treats them alike.
- A value goes into the **first** entry of the selector's group, the one readers reach first, or into a new entry when the group is empty; copies in later entries of the group are removed.
- Clearing removes the property from every entry of the group.

Without this rule, an edit to a report that uses `{ id: 'default' }` would land in a second, selector-less entry that no reader reaches. See [The report document model](the-report-document-model.md) for selectors in general.

## Renderer defaults

The value a control shows for a property set nowhere must be the value the visual really draws with. `rendererDefault()` in `effective.ts` finds it without keeping a second copy that could drift:

- **Visuals with a pure format resolver** (new card, legacy and multi-row cards, table, matrix, slicers) implement `VisualDefinition.formatDefaults(visualJson, theme)`. `probedDefaults()` runs it under `recordFallbacks()` (`core/report/props.ts`): every `getProp(ctx, object, prop, fallback)` call reports its `fallback` to a sink, and the pane shows the recorded value. A second run, with every Visual-tab switch turned on (`withSwitchesOn()`), records the properties a renderer reads only when their card is on. Results are cached per visual JSON and theme.
- **Container cards**: `containerDefault()` mirrors `report/chrome.ts` `resolveChrome()` and its exported constants.
- **Shapes, buttons and charts**: tables in `effective.ts` and `chartDefaults.ts`, built on the constants and resolvers the renderers export.

`asControlValue()` converts a recorded fallback into a value the control accepts (an enum option, a number, a color); a fallback of the wrong type is ignored.

Readers that report through their own resolution, such as the card visual's scoped `CardProps`, call `noteFallback()` directly. A default applied outside `getProp` (`reader.optStr(...) ?? x`) is invisible to this mechanism: pass it as the fallback instead.

### The tests that keep it honest

`effectiveDefaults.test.tsx` renders every gallery fixture with its `objects` removed (and again with every switch on), records the fallbacks the renderer passes, and checks that each Visual-tab control shows exactly that value. Values the renderer computes per render (decimal places, axis ranges, colors per series, label colors picked for contrast) are allowed to stay **Auto** only with a reason listed in `AUTO_REASONS`. A list of visual types, `IN_SCOPE`, must each have a fixture and may leave nothing else automatic. `propModel.test.ts` checks the container defaults against `resolveChrome`.

## Conditional formatting targets

The **fx** button appears on a row when `cfKindFor()` (`cf/target.ts`) returns a kind: every `color` property unless the definition says `conditional: false`, and text properties that are explicitly enabled or are `title.text`, `subTitle.text` or `general.altText`. A `CFTarget` names where the value lives:

| Field | Meaning |
|---|---|
| `pageName`, `visualName`, `container` | The visual and which bag. |
| `object`, `prop` | The property. |
| `baseSelector` | The property's own selector, for example `{ metadata: queryRef }` for one series. |
| `scoped` | The entry selector carries `data: [dataViewWildcard]` (per data point formatting, used for `dataPoint`). |
| `applyTo` | Offer **Apply to** (values, totals or both), for table and matrix cell elements. |
| `kind` | `color`, `text`, `icon`, `webURL` or `dataBars`. |

`findCF()` and `writeCF()` read and write the value; `cf/rules.ts` builds and parses the PBIR shapes Power BI writes for **Field value**, **Gradient** (`FillRule`), **Rules** (`Conditional`), icons and data bars. Parsing is lossless: what the editor does not model is kept and written back unchanged.

`cfRendered(visualType, target)` says whether Lumen's renderer evaluates the fx value of a target. When it does not, the fx dialog shows "Saved in Power BI format. Lumen doesn't preview conditional formatting on this property yet." The renderer side lives in `visuals/common/conditionalFormatting.ts`, `visuals/common/color.ts` and, for container colors, `report/containerCF.ts`.

## Considerations and limitations

- `cfRendered()` treats `dataPoint.fill` as rendered for every visual type. A new visual that offers a `dataPoint.fill` color row should evaluate its fx value (as the charts do through `buildCategorical`) or set `conditional: false` on the property, or the dialog will not warn that nothing is drawn.
- Gradient and rule bounds of type **Percent** and **Percentile** are not offered, because Lumen's evaluators do not compute the visual-level aggregates Power BI encodes for them (stated in `cf/rules.ts`).
- The pane writes every number as a double literal (`3D`), also for properties Power BI itself writes as integers (`3L`). How Power BI Desktop reads such a value back has not been verified.
- A theme-set value is shown as the theme's value, not compared with the renderer: pane and renderer resolve it through the same `props.ts` code.

## Related content

- [The visual contract](visual-contract.md)
- [Tutorial: add a visual](tutorial-add-a-visual.md)
- [The report document model](the-report-document-model.md)
- [Themes and text classes](themes-and-text-classes.md)
- [State and store](state-and-store.md)
- [Format properties (reference)](../reference/format-properties.md)
