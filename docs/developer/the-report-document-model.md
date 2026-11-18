# The report document model

> **Applies to:** Developers

This article describes how Lumen holds a report in memory: the `ReportDocument` type, pages, visual containers,
formatting objects and their selectors, how a formatting property is resolved, and how a write finds the entry to
change. Read it before you write code that reads or edits `visual.json` or `page.json`.

## PBIR JSON is the model

Lumen does not invent a parallel report model. The in-memory document is the PBIR JSON of a Power BI report
(*PBIR* is the Power BI enhanced report format: one JSON file per page and per visual), loosely typed and kept as
it was read. Editing a report means mutating that JSON; saving it means writing it back. Older layouts are
converted into the same shape when they are loaded (see [File format input and output](file-format-io.md)).

```ts
// src/core/report/types.ts
export interface ReportDocument {
  /** where it came from — affects how we save */
  origin: 'pbir' | 'pbix-legacy' | 'pbix-pbir' | 'new'
  /** definition.pbir content (dataset reference) */
  pbir?: any
  /** definition/report.json */
  report: any
  /** definition/version.json */
  version?: any
  /** definition/pages/pages.json */
  pagesMeta: { pageOrder: string[]; activePageName?: string; [k: string]: any }
  pages: PageDocument[]
  // ... bookmarksMeta, bookmarks, reportExtensions, theme, resources, extraFiles, diagnostics
}
```

| Field | File | Notes |
|---|---|---|
| `pbir` | `definition.pbir` | dataset reference: `byPath` (local semantic model) or `byConnection` (live) |
| `report` | `definition/report.json` | report settings, report-level filters (`filterConfig`), `themeCollection`, `resourcePackages`, report `objects` |
| `pagesMeta` | `definition/pages/pages.json` | `pageOrder`, `activePageName`; `pageOrder` is rebuilt from `pages` on save |
| `pages[]` | `definition/pages/<name>/page.json` | `PageDocument { name, json, visuals[] }` |
| `bookmarksMeta`, `bookmarks[]` | `definition/bookmarks/**` | `BookmarkDocument { name, json }` |
| `reportExtensions` | `definition/reportExtensions.json` | report-level measures |
| `theme` | resolved from resources | `{ base?, custom? }` parsed theme JSON (see [Themes and text classes](themes-and-text-classes.md)) |
| `resources` | `StaticResources/**` | `ResourceFile { path, bytes, mime? }`, keyed by path |
| `extraFiles` | anything else | written back unchanged |
| `diagnostics` | none | problems found while reading |

## Pages

A `PageDocument` holds the folder name (`name`) and the parsed `page.json` (`json`). The fields Lumen reads most:
`displayName`, `displayOption` (`FitToPage`, `FitToWidth`, `ActualSize`), `width` and `height` (default 1280 x
720), `visibility` (`HiddenInViewMode` for a hidden page), `filterConfig.filters` (page-level filters), `objects`
(page background, wallpaper, and so on) and `pageBinding` (drill-through and tooltip pages).

Pure helpers over pages and visuals live in `src/renderer/src/report/pbir.ts` (`pageInfo`, `pageType`,
`absoluteRect`, `childrenOf`, `topAncestor`, ...) and edits in `src/renderer/src/report/editOps.ts` (`addPage`,
`duplicatePage`, `movePage`, `addVisual`, `groupVisuals`, `reorderZ`, ...). Neither file uses React or the DOM, so
both are unit-testable.

## Visual containers

A `VisualDocument` is `{ name, json, mobile? }`: the folder name, the parsed `visual.json` (the *visual container*)
and the parsed `mobile.json` when the visual has a mobile layout. New object names are 20 lower-case hexadecimal
characters, like Power BI's (`newObjectName` in `report/pbir.ts`).

This is a bar chart from the built-in sample, shortened:

```json
{
  "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.4.0/schema.json",
  "name": "74321aaa8978218d17c3",
  "position": { "x": 432, "y": 460, "z": 13000, "width": 404, "height": 244, "tabOrder": 13000 },
  "visual": {
    "visualType": "barChart",
    "query": {
      "queryState": {
        "Category": { "projections": [{ "field": { "Column": { "Expression": { "SourceRef": { "Entity": "Region" } }, "Property": "Country" } }, "queryRef": "Region.Country", "nativeQueryRef": "Country", "active": true }] },
        "Y": { "projections": [{ "field": { "Measure": { "Expression": { "SourceRef": { "Entity": "_Measures" } }, "Property": "Total Sales" } }, "queryRef": "_Measures.Total Sales", "nativeQueryRef": "Total Sales" }] }
      },
      "sortDefinition": { "sort": [{ "field": { "Measure": { "...": "..." } }, "direction": "Descending" }] }
    },
    "objects": { "valueAxis": [{ "properties": { "gridlineStyle": { "expr": { "Literal": { "Value": "'dotted'" } } } } }] },
    "visualContainerObjects": { "title": [{ "properties": { "text": { "expr": { "Literal": { "Value": "'Sales by country'" } } } } }] },
    "drillFilterOtherVisuals": true
  }
}
```

- `position` is in page pixels. A visual inside a group has `parentGroupName`, and its position is relative to the
  group (`absoluteRect` adds the ancestors' offsets). `z` orders the stack; `tabOrder` the keyboard order.
- `visual.visualType` selects the renderer from the visual registry (see [Visual contract](visual-contract.md)).
- `visual.query.queryState` maps each *data role* (field well) to its *projections*: the fields placed in it, as
  SQ expressions (next section). See [Visual query pipeline](visual-query-pipeline.md).
- `visual.objects` holds the visual's own formatting; `visual.visualContainerObjects` the container formatting
  (title, subtitle, background, border, shadow, padding, header icons).
- A group has `visualGroup` instead of `visual`. `isHidden: true` hides a visual; `filterConfig` holds its visual
  filters; `annotations` is a list of `{ name, value }` strings.

## Field expressions, filters and literals

Fields, filters and identities use Power BI's semantic query (*SQ*) JSON throughout. `src/core/report/sq.ts`
provides the helpers: `fieldInfo` and `fieldKey` (identify a field expression), `columnExpr`, `measureExpr`,
`aggregationExpr` (build one), `identitiesToFilter` (turn selected data points into an SQ filter) and `inFilter`.
Report, page, visual, slicer, cross-filter and drill filters are all SQ filters, applied by the engine as
`CALCULATE` filter context (see [ARCHITECTURE.md](../ARCHITECTURE.md#key-semantics)).

Values inside SQ and formatting properties are *literals*, encoded as strings. `src/core/report/literal.ts`
converts them:

| Literal | JavaScript value |
|---|---|
| `'text'` (`''` escapes a quote) | `string` |
| `12L` | integer `number` |
| `1.5D`, `1.5M` | `number` (double, decimal) |
| `true`, `false` | `boolean` |
| `null` | `null` |
| `datetime'2024-01-31T00:00:00'` | `Date` whose UTC fields carry the wall-clock value |

`encodeLiteral` writes integers as `L`, other numbers as `D`, and dates as `datetime'...'`.

## Formatting objects, entries and selectors

Formatting is stored per *object* (a Format pane card, such as `title`, `legend`, `dataPoint`) as an array of
*entries*. Each entry has `properties` and an optional `selector` saying what it applies to:

```ts
// src/core/report/props.ts
export interface Selector {
  /** queryRef of a series/measure (`metadata` selector) */
  metadata?: string
  /** data-point scope selectors (raw PBIR) */
  data?: any[]
  /** named instance (e.g. `id: 'default'`, `id: 'selection:selected'`, button states `$id`) */
  id?: string
  [k: string]: any
}
export interface ObjectEntry { properties: Record<string, any>; selector?: Selector }
export type ObjectsBag = Record<string, ObjectEntry[]>
```

For example, a series colour is a `dataPoint` entry with `selector: { metadata: '_Measures.Total Sales' }`, and
a button's hover state is an entry with `selector: { id: 'hover' }`.

Property values are wrapped. A plain value is `{ expr: { Literal: { Value: "9D" } } }`; a colour is
`{ solid: { color: { expr: ... } } }`, where the inner expression is a literal or a `ThemeDataColor`
(`{ ColorId, Percent }`). A value can also be *data-bound* (a measure, `FillRule`, `Conditional`, ...: conditional
formatting); `isDataBound` detects those and `decodeValue` returns them raw for the visual to evaluate.

### The `{ id: 'default' }` group rule

Current Power BI writes `selector: { id: 'default' }` for the default formatting of the new card and other
new-format visuals; older reports and Lumen leave the selector out. Every reader treats the two alike and takes
the **first** entry, in array order, that holds the property.

A writer that matched selectors exactly would put an edit of a `{ id: 'default' }` report into a new selector-less
entry *behind* the first one, where no reader looks: the edit would silently do nothing. So
`src/core/report/entries.ts` defines one rule that every writer follows (the Format pane's `setRaw` in
`src/renderer/src/panes/visualizations/objects.ts`, conditional formatting, built-in icons and
`setObjectProp`):

- entries are grouped by selector with `id: 'default'` dropped (`entryGroupKey`): `{ id: 'default' }` belongs to the
  no-selector group, and `{ metadata: m, id: 'default' }` to the group of `{ metadata: m }`;
- a write goes into the first entry of the group (`primaryEntry`), or a new entry with the requested selector when
  the group is empty;
- copies of the property in later entries of the same group are removed, and entries left empty are dropped;
- clearing removes the property from every entry of the group.

```ts
// src/core/report/entries.ts
export function writeEntryProp(bag: ObjectsBag, object: string, prop: string, raw: any, selector?: Selector): void
```

If you write a property anywhere, call `writeEntryProp` (raw values) or `setObjectProp` (plain values, wrapped by
`literalProp`). Do not push entries yourself.

## Property resolution

Readers call `getProp(ctx, object, prop, fallback, selector?)` or `getColor(...)` with a `PropContext` built by
`makePropContext(visualJson, theme)`. The lookup order (`rawProp` in `src/core/report/props.ts`) is:

1. **Explicit formatting**: the visual's `objects`, then its `visualContainerObjects`. Within a bag, the first entry
   whose selector matches and that holds the property wins. If a selector was asked for and missed, and it has no
   `metadata` or `data` part (an `id` such as a button state), the default entry is used.
2. **Theme**: `visualStyles[visualType]['*'][object]`, then `visualStyles['*']['*'][object]` (the bag with the
   matching `$id` when a selector `id` is given, otherwise the first bag without `$id`), then the property wildcard
   `visualStyles['*']['*']['*']`.
3. **Renderer default**: the `fallback` argument.

A miss for a `metadata` or `data` selector does not fall back to the default entry; a reader that wants "this
series, else all series" asks twice.

Container chrome reads only `visualContainerObjects`: `resolveChrome` (`src/renderer/src/report/chrome.ts`) clears
`objects` from its context, because a visual's own objects can reuse a container object name for something else
(see [Container chrome and text](container-chrome-and-text.md)).

### Fallback recording

The default a visual draws with must be the one the Format pane shows. Instead of copying defaults into a table,
readers pass their default as `fallback`; `recordFallbacks(sink, fn)` reports every fallback read during `fn`, and
`noteFallback` lets readers with their own resolution report theirs. The Format pane runs a visual's
`formatDefaults` under `recordFallbacks` to show unset properties
(`src/renderer/src/panes/visualizations/effective.ts`). A reader that resolves a default outside `getProp` (for
example `optStr(...) ?? x`) is invisible to this mechanism. See [Format pane internals](format-pane-internals.md).

## Considerations and limitations

- The PBIR JSON is typed loosely (`any`). Validate shapes at the point of use and keep unknown keys: they are written
  back.
- Theme `visualStyles` are read only for the `'*'` style name; named styles under a visual type are not applied.
- `getProp` returns raw data-bound values for conditional formatting; a reader that expects a plain value must
  check `isDataBound` first.
- Legacy layouts converted on load are written back as PBIR, not in their original format (see
  [Saving and round-trip](saving-and-round-trip.md)).

## Related content

- [State and store](state-and-store.md)
- [Themes and text classes](themes-and-text-classes.md)
- [Visual contract](visual-contract.md)
- [Format pane internals](format-pane-internals.md)
- [Visual query pipeline](visual-query-pipeline.md)
- [Architecture reference](../ARCHITECTURE.md)
